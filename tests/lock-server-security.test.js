import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import Group from "../src/modules/groups/models/group.model.js";

async function runLockServerSecurityTests() {
  console.log("==================================================");
  console.log("STARTING LOCK SERVER SECURITY AUDIT & VERIFICATION SUITE");
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
    const { alice, bob } = sessions;
    const aliceCookies = alice.cookies;
    const bobCookies = bob.cookies;

    const aliceUser = await User.findOne({ email: "alice@test.com" });
    const bobUser = await User.findOne({ email: "bob@test.com" });
    const aliceId = String(aliceUser._id);
    const bobId = String(bobUser._id);

    // 1. S1 Rule 1: Enabling appLockEnabled without a PIN verifier must fail
    await testCase("1. S1: Reject appLockEnabled: true when no verifier exists", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ appLockEnabled: true });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Cannot enable App Lock without configuring a PIN/i);
    });

    // 2. Setup PIN via POST /users/lock/setup
    await testCase("2. Setup PIN via POST /users/lock/setup", async () => {
      const res = await request(env.app)
        .post("/api/v1/users/lock/setup")
        .set("Cookie", aliceCookies)
        .send({ pin: "1234" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.appLockEnabled, true);

      // Verify privacy reflects appLockEnabled: true
      const privRes = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", aliceCookies);
      assert.equal(privRes.body.data.appLockEnabled, true);
    });

    // 3. Verify PIN with POST /users/lock/verify
    let unlockToken = "";
    await testCase("3. Verify correct PIN returns signed unlock token", async () => {
      const res = await request(env.app)
        .post("/api/v1/users/lock/verify")
        .set("Cookie", aliceCookies)
        .send({ pin: "1234", scope: "app" });

      assert.equal(res.status, 200);
      assert.ok(res.body.data.unlockToken);
      unlockToken = res.body.data.unlockToken;
    });

    // 4. Rate limiting / lockout on failed attempts
    await testCase("4. Consecutive failed PIN attempts trigger 429 lockout", async () => {
      try {
        // 5 wrong attempts: first 4 return 401, 5th triggers 429
        for (let i = 0; i < 5; i++) {
          const res = await request(env.app)
            .post("/api/v1/users/lock/verify")
            .set("Cookie", aliceCookies)
            .send({ pin: "9999", scope: "app" });
          if (i < 4) {
            assert.equal(res.status, 401);
            assert.match(res.body.message, /Incorrect PIN/i);
          } else {
            // 5th attempt triggers lockout
            assert.equal(res.status, 429);
            assert.equal(res.body.code, "LOCKED_OUT");
          }
        }

        // Next attempt while locked out also returns 429
        const lockRes = await request(env.app)
          .post("/api/v1/users/lock/verify")
          .set("Cookie", aliceCookies)
          .send({ pin: "1234", scope: "app" });
        assert.equal(lockRes.status, 429);
        assert.equal(lockRes.body.code, "LOCKED_OUT");
      } finally {
        // Reset lockout in DB for subsequent tests
        await User.findByIdAndUpdate(aliceId, {
          $set: {
            lockFailedAttempts: 0,
            lockoutUntil: null,
          },
        });
      }
    });

    // 5. Send message from Bob to Alice and lock chat
    await testCase("5. Bob sends message to Alice, Alice locks chat with Bob", async () => {
      const sendRes = await request(env.app)
        .post(`/api/v1/messages/send/${aliceId}`)
        .set("Cookie", bobCookies)
        .send({ text: "Secret message from Bob" });
      assert.equal(sendRes.status, 201);

      // Alice locks Bob's chat
      const lockRes = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lockedChats: [bobId] });
      assert.equal(lockRes.status, 200);
      assert.deepEqual(lockRes.body.data.lockedChats, [bobId]);
    });

    // 6. Accessing messages with Bob without unlock token returns 423 Locked
    await testCase("6. Gating: GET /messages/:id without unlock token returns 423 Locked", async () => {
      const res = await request(env.app)
        .get(`/api/v1/messages/${bobId}`)
        .set("Cookie", aliceCookies);

      assert.equal(res.status, 423);
      assert.equal(res.body.code, "CHAT_LOCKED");
    });

    // 7. Accessing messages with Bob with valid unlock token returns 200
    await testCase("7. Gating: GET /messages/:id with valid unlock token returns 200 OK", async () => {
      // Re-verify PIN to get fresh token
      const verifyRes = await request(env.app)
        .post("/api/v1/users/lock/verify")
        .set("Cookie", aliceCookies)
        .send({ pin: "1234", scope: "app" });
      assert.equal(verifyRes.status, 200);
      const token = verifyRes.body.data.unlockToken;

      const res = await request(env.app)
        .get(`/api/v1/messages/${bobId}`)
        .set("Cookie", aliceCookies)
        .set("X-Chat-Unlock-Token", token);

      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body.data));
      assert.equal(res.body.data.length > 0, true);
      assert.equal(res.body.data[0].text, "Secret message from Bob");
    });

    // 8. Sidebar message redaction for locked chat
    await testCase("8. Sidebar: GET /messages redacts lastMessage for locked chat without token", async () => {
      const res = await request(env.app)
        .get("/api/v1/messages")
        .set("Cookie", aliceCookies);

      assert.equal(res.status, 200);
      const bobSidebar = res.body.data.find((u) => String(u.id) === bobId);
      assert.ok(bobSidebar);
      assert.equal(bobSidebar.isLocked, true);
      assert.ok(bobSidebar.lastMessage);
      assert.equal(bobSidebar.lastMessage.isLocked, true);
      assert.equal(bobSidebar.lastMessage.text, undefined);
    });

    // 9. Sidebar with valid unlock token reveals lastMessage
    await testCase("9. Sidebar: GET /messages reveals lastMessage with valid unlock token", async () => {
      const verifyRes = await request(env.app)
        .post("/api/v1/users/lock/verify")
        .set("Cookie", aliceCookies)
        .send({ pin: "1234", scope: "app" });
      const token = verifyRes.body.data.unlockToken;

      const res = await request(env.app)
        .get("/api/v1/messages")
        .set("Cookie", aliceCookies)
        .set("X-Chat-Unlock-Token", token);

      assert.equal(res.status, 200);
      const bobSidebar = res.body.data.find((u) => String(u.id) === bobId);
      assert.ok(bobSidebar);
      assert.equal(bobSidebar.lastMessage.text, "Secret message from Bob");
    });

    // 10. Group Lock gating with 423
    let testGroupId = "";
    await testCase("10. Group Lock gating: GET /groups/:id/messages returns 423 Locked", async () => {
      const groupRes = await request(env.app)
        .post("/api/v1/groups")
        .set("Cookie", aliceCookies)
        .send({
          name: "Secret Group",
          memberIds: JSON.stringify([bobId]),
        });
      assert.equal(groupRes.status, 201);
      testGroupId = String(groupRes.body.data.id || groupRes.body.data._id);

      // Send group message
      await request(env.app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", bobCookies)
        .send({ text: "Confidential group chat" });

      // Alice locks the group
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lockedChats: [bobId, testGroupId] });

      // Alice tries to read group messages without token -> 423
      const msgRes = await request(env.app)
        .get(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", aliceCookies);

      assert.equal(msgRes.status, 423);
      assert.equal(msgRes.body.code, "CHAT_LOCKED");
    });

    // 11. Step-up authentication required to remove locked chats
    await testCase("11. Step-up authentication required to unlock/remove from lockedChats", async () => {
      // Trying to remove bobId without step-up auth -> 403
      const unauthRes = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lockedChats: [testGroupId] }); // Bob is removed!

      assert.equal(unauthRes.status, 403);
      assert.match(unauthRes.body.message, /Step-up authentication.*required/i);

      // Providing current PIN in body succeeds
      const authRes = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lockedChats: [testGroupId], pin: "1234" });

      assert.equal(authRes.status, 200);
      assert.equal(authRes.body.data.lockedChats.includes(bobId), false);
      assert.equal(authRes.body.data.lockedChats.includes(testGroupId), true);
    });

    // 12. Password change invalidates unlock tokens
    await testCase("12. Password change increments lockEpoch, invalidating previous unlock tokens", async () => {
      // Issue a token with scope testGroupId
      const verifyRes = await request(env.app)
        .post("/api/v1/users/lock/verify")
        .set("Cookie", aliceCookies)
        .send({ pin: "1234", scope: testGroupId });
      assert.equal(verifyRes.status, 200);
      const oldToken = verifyRes.body.data.unlockToken;

      // Verify token works
      const preRes = await request(env.app)
        .get(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", aliceCookies)
        .set("X-Chat-Unlock-Token", oldToken);
      assert.equal(preRes.status, 200);

      // Change password
      const changeRes = await request(env.app)
        .patch("/api/v1/auth/change-password")
        .set("Cookie", aliceCookies)
        .send({
          currentPassword: "Password123!",
          newPassword: "NewPassword123!",
          confirmPassword: "NewPassword123!",
        });
      assert.equal(changeRes.status, 200);

      // Alice logs in with new password to get fresh session
      const loginRes = await request(env.app)
        .post("/api/v1/auth/login")
        .send({
          email: "alice@test.com",
          password: "NewPassword123!",
        });
      assert.equal(loginRes.status, 200);
      const newAliceCookies = loginRes.headers["set-cookie"];

      // Old token must now be rejected with 423 because lockEpoch was incremented
      const postRes = await request(env.app)
        .get(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", newAliceCookies)
        .set("X-Chat-Unlock-Token", oldToken);
      assert.equal(postRes.status, 423);
      assert.equal(postRes.body.code, "CHAT_LOCKED");

      // A newly issued token works
      const newVerifyRes = await request(env.app)
        .post("/api/v1/users/lock/verify")
        .set("Cookie", newAliceCookies)
        .send({ pin: "1234", scope: testGroupId });
      assert.equal(newVerifyRes.status, 200);
      const newToken = newVerifyRes.body.data.unlockToken;

      const workingRes = await request(env.app)
        .get(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", newAliceCookies)
        .set("X-Chat-Unlock-Token", newToken);
      assert.equal(workingRes.status, 200);
    });

    // 13. S6: Account deletion cleans up user from other users' lockedChats
    await testCase("13. Account deletion pulls deleted user ID from other users' lockedChats", async () => {
      // Bob locks Alice
      const lockRes = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bobCookies)
        .send({ lockedChats: [aliceId] });
      assert.equal(lockRes.status, 200);

      const bobPrivBefore = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", bobCookies);
      assert.equal(bobPrivBefore.body.data.lockedChats.includes(aliceId), true);

      // Re-login Alice to get valid cookies for delete-account
      const loginRes = await request(env.app)
        .post("/api/v1/auth/login")
        .send({
          email: "alice@test.com",
          password: "NewPassword123!",
        });
      assert.equal(loginRes.status, 200);
      const freshAliceCookies = loginRes.headers["set-cookie"];

      // Alice deletes her account
      const delRes = await request(env.app)
        .delete("/api/v1/auth/account")
        .set("Cookie", freshAliceCookies)
        .send({
          password: "NewPassword123!",
          confirmation: "DELETE",
        });
      assert.equal(delRes.status, 200);

      // Verify Bob's lockedChats no longer contains aliceId
      const bobPrivAfter = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", bobCookies);
      assert.equal(bobPrivAfter.body.data.lockedChats.includes(aliceId), false);
    });

  } finally {
    await teardownTestEnvironment(env);
  }

  console.log("==================================================");
  console.log(`LOCK SERVER SECURITY SUITE: Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runLockServerSecurityTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
