import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import { io as ioClient } from "socket.io-client";

async function runNotificationSettingsTests() {
  console.log("==================================================");
  console.log("STARTING NOTIFICATION SETTINGS BACKEND VERIFICATION");
  console.log("==================================================");

  const env = await setupTestEnvironment();
  let passed = 0;
  let failed = 0;
  let sessions = null;

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
    sessions = await createAndLoginUsers(env.app, env.port);
    const { alice, bob } = sessions;

    const aliceUser = await User.findOne({ email: "alice@test.com" });
    const aliceId = String(aliceUser._id);

    /* ================================================================ */
    /* 1. GET /api/settings/notifications & Defaults                    */
    /* ================================================================ */

    await testCase("1.1 GET /api/settings/notifications returns defaults for user", async () => {
      const res = await request(env.app)
        .get("/api/settings/notifications")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.settings);
      assert.equal(res.body.settings.soundEnabled, true);
      assert.equal(res.body.settings.soundVolume, 60);
      assert.equal(res.body.settings.desktopNotifications, false);
      assert.equal(res.body.settings.showPreview, true);
    });

    await testCase("1.2 GET /api/v1/settings/notifications returns same settings via v1 prefix", async () => {
      const res = await request(env.app)
        .get("/api/v1/settings/notifications")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.settings.soundEnabled, true);
    });

    await testCase("1.3 GET /api/settings/notifications unauthenticated rejected with 401", async () => {
      const res = await request(env.app).get("/api/settings/notifications");
      assert.equal(res.status, 401);
    });

    await testCase("1.4 Legacy user without notificationSettings receives default values", async () => {
      // Simulate legacy user by unsetting notificationSettings field
      await User.updateOne({ _id: aliceId }, { $unset: { notificationSettings: 1 } });

      const res = await request(env.app)
        .get("/api/settings/notifications")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.deepEqual(res.body.settings, {
        soundEnabled: true,
        soundVolume: 60,
        desktopNotifications: false,
        showPreview: true,
      });
    });

    /* ================================================================ */
    /* 2. PATCH /api/settings/notifications Valid & Partial Updates      */
    /* ================================================================ */

    await testCase("2.1 PATCH /api/settings/notifications updates soundEnabled", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundEnabled: false });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.settings.soundEnabled, false);
      assert.equal(res.body.settings.soundVolume, 60); // other fields preserved

      const dbUser = await User.findById(aliceId);
      assert.equal(dbUser.notificationSettings.soundEnabled, false);
    });

    await testCase("2.2 PATCH /api/settings/notifications updates soundVolume", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 85 });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.settings.soundVolume, 85);

      const dbUser = await User.findById(aliceId);
      assert.equal(dbUser.notificationSettings.soundVolume, 85);
    });

    await testCase("2.3 PATCH /api/settings/notifications updates desktopNotifications & showPreview", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ desktopNotifications: true, showPreview: false });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.settings.desktopNotifications, true);
      assert.equal(res.body.settings.showPreview, false);

      const dbUser = await User.findById(aliceId);
      assert.equal(dbUser.notificationSettings.desktopNotifications, true);
      assert.equal(dbUser.notificationSettings.showPreview, false);
    });

    await testCase("2.4 Boundary soundVolume values 0 and 100 are accepted", async () => {
      const res0 = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 0 });
      assert.equal(res0.status, 200);
      assert.equal(res0.body.settings.soundVolume, 0);

      const res100 = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 100 });
      assert.equal(res100.status, 200);
      assert.equal(res100.body.settings.soundVolume, 100);
    });

    /* ================================================================ */
    /* 3. Validation & Security Negative Tests                          */
    /* ================================================================ */

    await testCase("3.1 PATCH rejects invalid boolean value with 400", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundEnabled: "invalid_boolean" });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    await testCase("3.2 PATCH rejects out-of-range soundVolume (> 100) with 400", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 150 });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    await testCase("3.3 PATCH rejects out-of-range soundVolume (< 0) with 400", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: -10 });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    await testCase("3.4 PATCH rejects unknown fields (prevent mass assignment) with 400", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 50, isAdmin: true, role: "admin", password: "hacked" });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);

      // Verify no arbitrary user properties were modified
      const dbUser = await User.findById(aliceId);
      assert.equal(dbUser.isAdmin, undefined);
    });

    await testCase("3.5 PATCH rejects empty update object with 400", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    await testCase("3.6 PATCH unauthenticated rejected with 401", async () => {
      const res = await request(env.app)
        .patch("/api/settings/notifications")
        .send({ soundEnabled: true });

      assert.equal(res.status, 401);
    });

    /* ================================================================ */
    /* 4. Socket.IO Real-Time Synchronization Tests                     */
    /* ================================================================ */

    await testCase("4.1 Socket event settings:notifications:updated emitted on update", async () => {
      // Connect second socket for Alice (simulating second tab / secondary device)
      const aliceSocket2 = ioClient(`http://127.0.0.1:${env.port}`, {
        auth: { token: alice.accessToken },
        extraHeaders: { Cookie: alice.cookies },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise((resolve) => aliceSocket2.on("connect", resolve));

      const eventPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout waiting for socket event")), 3000);
        aliceSocket2.on("settings:notifications:updated", (payload) => {
          clearTimeout(timer);
          resolve(payload);
        });
      });

      const patchRes = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 72, soundEnabled: true });

      assert.equal(patchRes.status, 200);

      const received = await eventPromise;
      assert.ok(received.settings);
      assert.equal(received.settings.soundVolume, 72);
      assert.equal(received.settings.soundEnabled, true);
      assert.ok(received.updatedAt);
      assert.equal(received.message, undefined, "No message content should leak into notification settings event");

      aliceSocket2.disconnect();
    });

    await testCase("4.2 No socket event emitted when PATCH validation fails", async () => {
      let eventFired = false;
      const handler = () => { eventFired = true; };
      alice.socket.on("settings:notifications:updated", handler);

      const patchRes = await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 999 }); // invalid

      assert.equal(patchRes.status, 400);

      await new Promise((r) => setTimeout(r, 200));
      alice.socket.off("settings:notifications:updated", handler);
      assert.equal(eventFired, false, "Socket event must NOT be emitted on validation failure");
    });

    await testCase("4.3 User B does NOT receive Alice's settings:notifications:updated event", async () => {
      let bobReceivedEvent = false;
      const bobHandler = () => { bobReceivedEvent = true; };
      bob.socket.on("settings:notifications:updated", bobHandler);

      await request(env.app)
        .patch("/api/settings/notifications")
        .set("Cookie", alice.cookies)
        .send({ soundVolume: 45 });

      await new Promise((r) => setTimeout(r, 200));
      bob.socket.off("settings:notifications:updated", bobHandler);
      assert.equal(bobReceivedEvent, false, "Another user should never receive Alice's settings update");
    });

  } finally {
    for (const s of Object.values(sessions?.allSessions || {})) {
      if (s.socket?.connected) s.socket.disconnect();
    }
    await teardownTestEnvironment(env);
  }

  console.log("==================================================");
  console.log(`NOTIFICATION SETTINGS SUITE: Passed: ${passed} | Failed: ${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runNotificationSettingsTests();
