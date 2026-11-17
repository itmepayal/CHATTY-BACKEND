import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import Group from "../src/modules/groups/models/group.model.js";

async function runUnifiedAppLockTests() {
  console.log("==================================================");
  console.log("STARTING UNIFIED APP LOCK & PIN CONFIGURATION SUITE");
  console.log("==================================================");

  const env = await setupTestEnvironment();
  let passed = 0;
  let failed = 0;

  const testCase = async (name, fn) => {
    try {
      await fn();
      console.log(`[✓ PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[✗ FAIL] ${name}:`, err.message);
      failed++;
    }
  };

  try {
    const sessions = await createAndLoginUsers(env.app, env.port);
    const { alice, bob, charlie } = sessions;
    const aliceCookies = alice.cookies;
    const bobCookies = bob.cookies;

    const aliceUser = await User.findOne({ email: "alice@test.com" });
    const bobUser = await User.findOne({ email: "bob@test.com" });
    const charlieUser = await User.findOne({ email: "charlie@test.com" });

    const aliceId = String(aliceUser._id);
    const bobId = String(bobUser._id);
    const charlieId = String(charlieUser._id);

    // Create Group 1 with Alice as owner and Bob as member
    const group1Res = await request(env.app)
      .post("/api/v1/groups")
      .set("Cookie", aliceCookies)
      .send({
        name: "Alice & Bob Group",
        memberIds: JSON.stringify([bobId]),
      });
    assert.equal(group1Res.status, 201);
    const group1Id = String(group1Res.body.data.id || group1Res.body.data._id);

    // Create Group 2 with Bob as owner and Charlie as member (Alice is NOT a member)
    const group2Res = await request(env.app)
      .post("/api/v1/groups")
      .set("Cookie", bobCookies)
      .send({
        name: "Bob & Charlie Group",
        memberIds: JSON.stringify([charlieId]),
      });
    assert.equal(group2Res.status, 201);
    const group2Id = String(group2Res.body.data.id || group2Res.body.data._id);

    // 1. One-Time PIN Configuration: Alice sets PIN once
    await testCase("1. One-Time PIN Configuration: Alice configures App Lock PIN once", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({
          appLockEnabled: true,
          appLockPinHash: "pbkdf2$100000$salt123$hash456",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.appLockEnabled, true);
      // Hash is sanitized and not returned to client
      assert.equal(res.body.data.appLockPinHash, undefined);

      const dbUser = await User.findById(aliceId).select("+appLockPinHash");
      assert.equal(dbUser.appLockEnabled, true);
      assert.equal(dbUser.appLockPinHash, "pbkdf2$100000$salt123$hash456");
    });

    // 2. GET /api/v1/users/privacy reflects appLockEnabled=true without leaking hash
    await testCase("2. GET /api/v1/users/privacy returns appLockEnabled=true, hides hash", async () => {
      const res = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", aliceCookies);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.appLockEnabled, true);
      assert.equal(res.body.data.appLockPinHash, undefined);
    });

    // 3. Alice locks individual chat with Bob
    await testCase("3. Individual Chat Locking: Alice locks chat with Bob", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({
          lockedChats: [bobId],
        });

      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data.lockedChats, [bobId]);
    });

    // 4. Alice locks Group 1 using the same global App Lock PIN configuration
    await testCase("4. Group Chat Locking: Alice locks Group 1 without re-configuring PIN", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({
          lockedChats: [bobId, group1Id],
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.lockedChats.includes(bobId), true);
      assert.equal(res.body.data.lockedChats.includes(group1Id), true);
    });

    // 5. Independent Lock States: Group 2 and Charlie remain unlocked
    await testCase("5. Independent Lock States: Group 2 and Charlie remain unlocked", async () => {
      const res = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", aliceCookies);

      assert.equal(res.status, 200);
      const locked = res.body.data.lockedChats;
      assert.equal(locked.includes(bobId), true, "Bob should be locked");
      assert.equal(locked.includes(group1Id), true, "Group 1 should be locked");
      assert.equal(locked.includes(charlieId), false, "Charlie should NOT be locked");
      assert.equal(locked.includes(group2Id), false, "Group 2 should NOT be locked");
    });

    // 6. Security authorization: Alice cannot lock Group 2 (non-member)
    await testCase("6. Security Guard: Alice cannot lock Group 2 (non-member)", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({
          lockedChats: [bobId, group1Id, group2Id],
        });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Invalid conversation or group/i);
    });

    // 7. Group Lifecycle Cleanup: Destroying Group 1 removes it from lockedChats
    await testCase("7. Group Lifecycle Cleanup: Destroying Group 1 removes it from lockedChats", async () => {
      const deleteRes = await request(env.app)
        .delete(`/api/v1/groups/${group1Id}`)
        .set("Cookie", aliceCookies);

      assert.equal(deleteRes.status, 200);

      const privRes = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", aliceCookies);

      assert.equal(privRes.status, 200);
      assert.equal(privRes.body.data.lockedChats.includes(group1Id), false);
      assert.equal(privRes.body.data.lockedChats.includes(bobId), true);
    });

    // 8. User format verification: /users/me preserves _id alongside id
    await testCase("8. Format user preserves _id alongside id for AppLockStore reconciliation", async () => {
      const meRes = await request(env.app)
        .get("/api/v1/users/me")
        .set("Cookie", aliceCookies);

      assert.equal(meRes.status, 200);
      const user = meRes.body.data.user || meRes.body.data;
      assert.ok(user.id, "id must be present");
      assert.ok(user._id, "_id must be present to prevent undefined store lookup");
      assert.equal(String(user._id), String(user.id));
    });

  } finally {
    await teardownTestEnvironment(env);
  }

  console.log("==================================================");
  console.log(`UNIFIED APP LOCK TEST SUITE: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runUnifiedAppLockTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
