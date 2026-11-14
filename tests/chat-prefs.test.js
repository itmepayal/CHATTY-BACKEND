import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers, TEST_PASSWORD } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";

async function runTests() {
  console.log("Setting up test environment for chat preferences...");
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
    const cookies = alice.cookies;

    // 1. GET /api/v1/users/chat-prefs returns defaults
    await testCase("GET /api/v1/users/chat-prefs returns default settings", async () => {
      const res = await request(env.app)
        .get("/api/v1/users/chat-prefs")
        .set("Cookie", cookies);

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      assert.equal(res.body.success, true);
      const data = res.body.data;
      assert.equal(data.enterToSend, true);
      assert.equal(data.largeEmoji, true);
      assert.equal(data.autoScroll, true);
    });

    // 2. PATCH /api/v1/users/chat-prefs with { enterToSend: false } succeeds
    await testCase("PATCH /api/v1/users/chat-prefs with { enterToSend: false } succeeds", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ enterToSend: false });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.enterToSend, false);
      assert.equal(res.body.data.largeEmoji, true);
      assert.equal(res.body.data.autoScroll, true);
    });

    // 3. PATCH /api/v1/users/chat-prefs with { largeEmoji: false } succeeds
    await testCase("PATCH /api/v1/users/chat-prefs with { largeEmoji: false } succeeds", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ largeEmoji: false });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.enterToSend, false); // preserved
      assert.equal(res.body.data.largeEmoji, false);
      assert.equal(res.body.data.autoScroll, true);   // preserved
    });

    // 4. PATCH /api/v1/users/chat-prefs with { autoScroll: false } succeeds
    await testCase("PATCH /api/v1/users/chat-prefs with { autoScroll: false } succeeds", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ autoScroll: false });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.enterToSend, false); // preserved
      assert.equal(res.body.data.largeEmoji, false);  // preserved
      assert.equal(res.body.data.autoScroll, false);
    });

    // 5. Partial update safety: Toggle enterToSend back to true
    await testCase("Partial update: Toggle enterToSend back to true preserves largeEmoji & autoScroll false", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ enterToSend: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.enterToSend, true);
      assert.equal(res.body.data.largeEmoji, false);
      assert.equal(res.body.data.autoScroll, false);
    });

    // 6. Update all three simultaneously
    await testCase("Update all three chat preferences simultaneously", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ enterToSend: false, largeEmoji: true, autoScroll: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.enterToSend, false);
      assert.equal(res.body.data.largeEmoji, true);
      assert.equal(res.body.data.autoScroll, true);
    });

    // 7. Verify MongoDB document directly
    await testCase("Verify direct MongoDB persistence of chat preferences", async () => {
      const user = await User.findById(alice.user._id);
      assert.ok(user);
      assert.equal(user.enterToSend, false);
      assert.equal(user.largeEmoji, true);
      assert.equal(user.autoScroll, true);
    });

    // 8. Alias mapping: enterIsSend maps to enterToSend
    await testCase("Alias mapping: enterIsSend maps to enterToSend", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ enterIsSend: true });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.enterToSend, true);
    });

    // 9. Rejection of unknown field
    await testCase("Unknown field rejected with 400 Bad Request", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ unknownChatField: true });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.ok(res.body.message.includes("Unknown field(s)"));
    });

    // 10. Rejection of non-boolean values
    await testCase("Non-boolean for enterToSend rejected with 400", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ enterToSend: "true" });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.ok(res.body.message.includes("must be a boolean"));
    });

    // 11. Empty body rejected with 400
    await testCase("Empty body rejected with 400", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    // 12. Unauthenticated request rejected with 401
    await testCase("Unauthenticated request rejected with 401 Unauthorized", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .send({ enterToSend: true });

      assert.equal(res.status, 401);
      assert.equal(res.body.success, false);
    });

    // 13. Verify unrelated preferences (Appearance & Privacy) remain intact
    await testCase("Updating chat preferences does not mutate appearance or privacy settings", async () => {
      // Set appearance
      await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ theme: "dracula", fontSize: "lg" });

      // Update chat prefs
      await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ enterToSend: true, largeEmoji: true, autoScroll: true });

      // Verify appearance unchanged
      const appRes = await request(env.app)
        .get("/api/v1/users/appearance")
        .set("Cookie", cookies);

      assert.equal(appRes.status, 200);
      assert.equal(appRes.body.data.theme, "dracula");
      assert.equal(appRes.body.data.fontSize, "lg");
    });

    // 14. Preferences persist across logout and re-login
    await testCase("Preferences persist across logout, re-login, and checkAuth", async () => {
      // Set custom chat preferences
      await request(env.app)
        .patch("/api/v1/users/chat-prefs")
        .set("Cookie", cookies)
        .send({ enterToSend: false, largeEmoji: false, autoScroll: true });

      // Logout
      await request(env.app)
        .post("/api/v1/auth/logout")
        .set("Cookie", cookies);

      // Re-login
      const loginRes = await request(env.app)
        .post("/api/v1/auth/login")
        .send({ email: alice.user.email, password: TEST_PASSWORD });

      assert.equal(loginRes.status, 200);
      const newCookies = loginRes.headers["set-cookie"];

      // Check auth endpoint returns saved preferences
      const checkRes = await request(env.app)
        .get("/api/v1/auth/check")
        .set("Cookie", newCookies);

      assert.equal(checkRes.status, 200);
      const user = checkRes.body.data.user || checkRes.body.data;
      assert.equal(user.enterToSend, false);
      assert.equal(user.largeEmoji, false);
      assert.equal(user.autoScroll, true);

      // GET /api/v1/users/chat-prefs also matches
      const prefsRes = await request(env.app)
        .get("/api/v1/users/chat-prefs")
        .set("Cookie", newCookies);

      assert.equal(prefsRes.status, 200);
      assert.equal(prefsRes.body.data.enterToSend, false);
      assert.equal(prefsRes.body.data.largeEmoji, false);
      assert.equal(prefsRes.body.data.autoScroll, true);
    });

    // 15. Other users' preferences are completely isolated
    await testCase("Chat preferences for Alice do not affect Bob", async () => {
      const bobRes = await request(env.app)
        .get("/api/v1/users/chat-prefs")
        .set("Cookie", bob.cookies);

      assert.equal(bobRes.status, 200);
      assert.equal(bobRes.body.data.enterToSend, true);
      assert.equal(bobRes.body.data.largeEmoji, true);
      assert.equal(bobRes.body.data.autoScroll, true);
    });

  } finally {
    console.log("Tearing down test environment...");
    await teardownTestEnvironment(env);
  }

  console.log("\n========================================");
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log("========================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
