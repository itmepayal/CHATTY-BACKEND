import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";

test("Device Linking E2EE Suite", async (t) => {
  const env = await setupTestEnvironment();
  const app = env.app;
  const users = await createAndLoginUsers(app, env.port);
  const alice = users.alice;
  const bob = users.bob;

  const sampleEphemeralKey = {
    kty: "EC",
    crv: "P-256",
    x: "W98p5T6W61qJ1KjY64EwUoZl9cO2L5mG3uV6x7y8z9A",
    y: "N12o3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H2",
  };

  await t.test("1. Device B requests a linking session", async () => {
    const res = await request(app)
      .post("/api/v1/e2ee/devices/link/request")
      .set("Cookie", alice.cookies)
      .send({
        ephemeralPublicKey: sampleEphemeralKey,
        deviceId: "device_laptop_b_123",
        deviceName: "Alice's MacBook Pro",
      })
      .expect(201);

    assert.ok(res.body?.data?.linkSessionId, "Must return linkSessionId");
    assert.ok(res.body?.data?.linkingPin, "Must return linkingPin");
    assert.ok(res.body?.data?.expiresAt, "Must return expiresAt");
  });

  await t.test("2. Device B polls status of pending session", async () => {
    const reqRes = await request(app)
      .post("/api/v1/e2ee/devices/link/request")
      .set("Cookie", alice.cookies)
      .send({
        ephemeralPublicKey: sampleEphemeralKey,
        deviceId: "device_laptop_b_456",
        deviceName: "Alice's MacBook Pro",
      })
      .expect(201);

    const linkSessionId = reqRes.body.data.linkSessionId;

    const statusRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/status/${linkSessionId}`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(statusRes.body?.data?.status, "pending");
    assert.ok(statusRes.body?.data?.linkingPin);
  });

  await t.test(
    "3. Device A approves linking session via linkSessionId",
    async () => {
      const reqRes = await request(app)
        .post("/api/v1/e2ee/devices/link/request")
        .set("Cookie", alice.cookies)
        .send({
          ephemeralPublicKey: sampleEphemeralKey,
          deviceId: "device_laptop_b_789",
          deviceName: "Alice's iPad",
        })
        .expect(201);

      const linkSessionId = reqRes.body.data.linkSessionId;
      const fakeEncryptedPayload = {
        ciphertext: "ZXhhbXBsZUNpcGhlcnRleHRkYXRh",
        iv: "ZXhhbXBsZUl2MTI=",
      };

      const approveRes = await request(app)
        .post("/api/v1/e2ee/devices/link/approve")
        .set("Cookie", alice.cookies)
        .send({
          linkSessionId,
          encryptedPayload: fakeEncryptedPayload,
          approverDeviceId: "device_phone_a_001",
        })
        .expect(200);

      assert.equal(approveRes.body?.data?.success, true);
      assert.equal(approveRes.body?.data?.linkSessionId, linkSessionId);

      // Device B polls and receives approved status with encrypted payload
      const finalRes = await request(app)
        .get(`/api/v1/e2ee/devices/link/status/${linkSessionId}`)
        .set("Cookie", alice.cookies)
        .expect(200);

      assert.equal(finalRes.body?.data?.status, "approved");
      assert.deepEqual(
        finalRes.body?.data?.encryptedPayload,
        fakeEncryptedPayload,
      );
      assert.equal(finalRes.body?.data?.approverDeviceId, "device_phone_a_001");
    },
  );

  await t.test(
    "4. Device A approves linking session via 6-digit linkingPin",
    async () => {
      const reqRes = await request(app)
        .post("/api/v1/e2ee/devices/link/request")
        .set("Cookie", alice.cookies)
        .send({
          ephemeralPublicKey: sampleEphemeralKey,
          deviceId: "device_laptop_b_pin_test",
          deviceName: "Alice's Work PC",
        })
        .expect(201);

      const linkingPin = reqRes.body.data.linkingPin;
      const linkSessionId = reqRes.body.data.linkSessionId;
      const fakeEncryptedPayload = {
        ciphertext: "cGludGVzdENpcGhlcnRleHQ=",
        iv: "cGludGVzdEl2MTIz",
      };

      const approveRes = await request(app)
        .post("/api/v1/e2ee/devices/link/approve")
        .set("Cookie", alice.cookies)
        .send({
          linkingPin,
          encryptedPayload: fakeEncryptedPayload,
          approverDeviceId: "device_phone_a_001",
        })
        .expect(200);

      assert.equal(approveRes.body?.data?.success, true);
      assert.equal(approveRes.body?.data?.linkSessionId, linkSessionId);
    },
  );

  await t.test(
    "5. Cross-user rejection: Bob cannot access Alice's link session",
    async () => {
      const reqRes = await request(app)
        .post("/api/v1/e2ee/devices/link/request")
        .set("Cookie", alice.cookies)
        .send({
          ephemeralPublicKey: sampleEphemeralKey,
          deviceId: "device_alice_secret",
          deviceName: "Alice's Secret Tab",
        })
        .expect(201);

      const linkSessionId = reqRes.body.data.linkSessionId;

      // Bob tries to get status of Alice's session
      await request(app)
        .get(`/api/v1/e2ee/devices/link/status/${linkSessionId}`)
        .set("Cookie", bob.cookies)
        .expect(404);

      // Bob tries to approve Alice's session -> must be rejected with 403 Forbidden
      await request(app)
        .post("/api/v1/e2ee/devices/link/approve")
        .set("Cookie", bob.cookies)
        .send({
          linkSessionId,
          encryptedPayload: { ciphertext: "evil", iv: "evil" },
          approverDeviceId: "bobs_device",
        })
        .expect(403);
    },
  );

  await t.test(
    "6. Device A looks up pending session by 6-digit PIN",
    async () => {
      const reqRes = await request(app)
        .post("/api/v1/e2ee/devices/link/request")
        .set("Cookie", alice.cookies)
        .send({
          ephemeralPublicKey: sampleEphemeralKey,
          deviceId: "device_pin_lookup_test",
          deviceName: "Alice's Work Laptop",
        })
        .expect(201);

      const linkingPin = reqRes.body.data.linkingPin;
      const linkSessionId = reqRes.body.data.linkSessionId;

      const lookupRes = await request(app)
        .get(`/api/v1/e2ee/devices/link/pin/${linkingPin}`)
        .set("Cookie", alice.cookies)
        .expect(200);

      assert.equal(lookupRes.body?.data?.linkSessionId, linkSessionId);
      assert.equal(lookupRes.body?.data?.linkingPin, linkingPin);
      assert.deepEqual(
        lookupRes.body?.data?.ephemeralPublicKey,
        sampleEphemeralKey,
      );
      assert.equal(lookupRes.body?.data?.newDeviceId, "device_pin_lookup_test");
    },
  );

  await t.test(
    "7. Device registration rejects static fallback device ID (HTTP 400)",
    async () => {
      const res = await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "device-session-fallback",
          publicKey: sampleEphemeralKey,
          deviceName: "Static Fallback Device",
        })
        .expect(400);

      assert.ok(res.body?.message?.includes("fallback") || res.body?.errors);
    },
  );

  await t.test(
    "8. Device registration is an idempotent upsert: does not create duplicate documents",
    async () => {
      const testDeviceId = "persistent-unique-dev-123";
      // First registration
      const res1 = await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: testDeviceId,
          publicKey: sampleEphemeralKey,
          deviceName: "Initial Device Name",
        })
        .expect(201);

      assert.equal(res1.body?.data?.deviceId, testDeviceId);

      // Second registration with updated name (same device ID)
      const res2 = await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: testDeviceId,
          publicKey: sampleEphemeralKey,
          deviceName: "Updated Device Name",
        })
        .expect(201);

      assert.equal(res2.body?.data?.deviceId, testDeviceId);
      assert.equal(res2.body?.data?.deviceName, "Updated Device Name");

      // Verify device list only contains ONE entry for this deviceId
      const listRes = await request(app)
        .get("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .expect(200);

      const matching = listRes.body?.data?.devices.filter(
        (d) => d.deviceId === testDeviceId,
      );
      assert.equal(matching.length, 1, "Must not create duplicate device documents");
    },
  );

  await t.test(
    "9. Heartbeat endpoint updates last active timestamp for registered device",
    async () => {
      const testDeviceId = "persistent-unique-dev-123";
      const hbRes = await request(app)
        .post("/api/v1/e2ee/devices/heartbeat")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: testDeviceId,
        })
        .expect(200);

      assert.equal(hbRes.body?.data?.active, true);
      assert.equal(hbRes.body?.data?.registered, true);
      assert.equal(hbRes.body?.data?.deviceId, testDeviceId);
      assert.ok(hbRes.body?.data?.lastActiveAt);

      // Heartbeat rejects static fallback device ID with 400
      await request(app)
        .post("/api/v1/e2ee/devices/heartbeat")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "device-session-fallback",
        })
        .expect(400);
    },
  );

  await t.test(
    "10. Revocation semantics: revoked device excluded from list and cannot re-register",
    async () => {
      const revokeDeviceId = "revokable-dev-999";
      await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: revokeDeviceId,
          publicKey: sampleEphemeralKey,
          deviceName: "To Be Revoked",
        })
        .expect(201);

      // Revoke the device
      const revRes = await request(app)
        .delete(`/api/v1/e2ee/devices/${revokeDeviceId}`)
        .set("Cookie", alice.cookies)
        .expect(200);

      assert.equal(revRes.body?.data?.revoked, true);

      // Device list must not include revoked device
      const listRes = await request(app)
        .get("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .expect(200);

      const hasRevoked = listRes.body?.data?.devices.some(
        (d) => d.deviceId === revokeDeviceId,
      );
      assert.equal(hasRevoked, false, "Revoked device must be excluded from active devices");

      // Attempting to re-register the revoked device must return 403 Forbidden
      await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: revokeDeviceId,
          publicKey: sampleEphemeralKey,
          deviceName: "Re-register Attempt",
        })
        .expect(403);

      // Heartbeat on revoked device must return 403 Forbidden
      await request(app)
        .post("/api/v1/e2ee/devices/heartbeat")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: revokeDeviceId,
        })
        .expect(403);
    },
  );

  await teardownTestEnvironment();
});
