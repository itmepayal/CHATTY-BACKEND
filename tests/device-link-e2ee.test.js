import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import DeviceLinkSession from "../src/modules/e2ee/models/device-link-session.model.js";

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

  await t.test(
    "11. Create session -> approve within TTL succeeds (with normalized 6-digit PIN and hyphenated PIN, and idempotent retry)",
    async () => {
      const reqRes = await request(app)
        .post("/api/v1/e2ee/devices/link/request")
        .set("Cookie", alice.cookies)
        .send({
          ephemeralPublicKey: sampleEphemeralKey,
          deviceId: "device_ttl_test_new",
          deviceName: "Alice's Android Phone",
        })
        .expect(201);

      const linkingPin = reqRes.body.data.linkingPin;
      const linkSessionId = reqRes.body.data.linkSessionId;

      // Verify PIN is exactly 6 pure digits
      assert.equal(typeof linkingPin, "string");
      assert.match(linkingPin, /^\d{6}$/, "Generated PIN must be exactly 6 digits");

      // Test lookup with hyphenated input: e.g. "123-456"
      const hyphenatedPin = `${linkingPin.slice(0, 3)}-${linkingPin.slice(3)}`;
      const lookupHyphenRes = await request(app)
        .get(`/api/v1/e2ee/devices/link/pin/${hyphenatedPin}`)
        .set("Cookie", alice.cookies)
        .expect(200);

      assert.equal(lookupHyphenRes.body?.data?.linkSessionId, linkSessionId);

      const fakeEncryptedPayload = {
        ciphertext: "dHRsVGVzdENpcGhlcnRleHQ=",
        iv: "dHRsVGVzdEl2MTIz",
      };

      // Approve within TTL succeeds
      const approveRes = await request(app)
        .post("/api/v1/e2ee/devices/link/approve")
        .set("Cookie", alice.cookies)
        .send({
          linkingPin: hyphenatedPin,
          encryptedPayload: fakeEncryptedPayload,
          approverDeviceId: "device_phone_a_001",
        })
        .expect(200);

      assert.equal(approveRes.body?.data?.success, true);
      assert.equal(approveRes.body?.data?.linkSessionId, linkSessionId);

      // Idempotent retry: approving again within TTL succeeds
      const retryApproveRes = await request(app)
        .post("/api/v1/e2ee/devices/link/approve")
        .set("Cookie", alice.cookies)
        .send({
          linkingPin: linkingPin,
          encryptedPayload: fakeEncryptedPayload,
          approverDeviceId: "device_phone_a_001",
        })
        .expect(200);

      assert.equal(retryApproveRes.body?.data?.success, true);
    },
  );

  await t.test("12. Approve after TTL returns 'expired'", async () => {
    const reqRes = await request(app)
      .post("/api/v1/e2ee/devices/link/request")
      .set("Cookie", alice.cookies)
      .send({
        ephemeralPublicKey: sampleEphemeralKey,
        deviceId: "device_expired_test",
        deviceName: "Alice's Expired Tablet",
      })
      .expect(201);

    const linkingPin = reqRes.body.data.linkingPin;
    const linkSessionId = reqRes.body.data.linkSessionId;

    // Fast-forward expiry into the past
    await DeviceLinkSession.updateOne(
      { linkSessionId },
      { $set: { expiresAt: new Date(Date.now() - 5000) } },
    );

    // Lookup after TTL returns expired (HTTP 410 Gone)
    const lookupRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/pin/${linkingPin}`)
      .set("Cookie", alice.cookies)
      .expect(410);

    assert.match(
      lookupRes.body?.message?.toLowerCase() || "",
      /expired/,
      "Lookup error message must indicate expired session",
    );

    // Approve after TTL returns expired (HTTP 410 Gone)
    const approveRes = await request(app)
      .post("/api/v1/e2ee/devices/link/approve")
      .set("Cookie", alice.cookies)
      .send({
        linkingPin,
        encryptedPayload: { ciphertext: "expired", iv: "expired" },
        approverDeviceId: "device_phone_a_001",
      })
      .expect(410);

    assert.match(
      approveRes.body?.message?.toLowerCase() || "",
      /expired/,
      "Approve error message must indicate expired session",
    );
  });

  await t.test("13. Wrong code returns 'invalid code'", async () => {
    // Non-existent 6-digit PIN
    const wrongPin = "000000";

    const lookupRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/pin/${wrongPin}`)
      .set("Cookie", alice.cookies)
      .expect(404);

    assert.match(
      lookupRes.body?.message?.toLowerCase() || "",
      /invalid.*code|not found/,
      "Lookup with wrong code must return invalid code / not found message",
    );

    const approveRes = await request(app)
      .post("/api/v1/e2ee/devices/link/approve")
      .set("Cookie", alice.cookies)
      .send({
        linkingPin: wrongPin,
        encryptedPayload: { ciphertext: "wrong", iv: "wrong" },
        approverDeviceId: "device_phone_a_001",
      })
      .expect(404);

    assert.match(
      approveRes.body?.message?.toLowerCase() || "",
      /invalid.*code|not found/,
      "Approve with wrong code must return invalid code / not found message",
    );

    // Malformed code (< 6 digits) returns 400 Bad Request
    const malformedRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/pin/123`)
      .set("Cookie", alice.cookies)
      .expect(400);

    assert.match(
      malformedRes.body?.message?.toLowerCase() || "",
      /invalid.*code/,
      "Lookup with malformed code must return invalid code message",
    );
  });

  await t.test("14. Already used session returns 'already used'", async () => {
    const reqRes = await request(app)
      .post("/api/v1/e2ee/devices/link/request")
      .set("Cookie", alice.cookies)
      .send({
        ephemeralPublicKey: sampleEphemeralKey,
        deviceId: "device_already_used_test",
        deviceName: "Alice's Secondary Device",
      })
      .expect(201);

    const linkingPin = reqRes.body.data.linkingPin;
    const linkSessionId = reqRes.body.data.linkSessionId;

    // Approve session first time
    await request(app)
      .post("/api/v1/e2ee/devices/link/approve")
      .set("Cookie", alice.cookies)
      .send({
        linkingPin,
        encryptedPayload: { ciphertext: "payload1", iv: "iv1" },
        approverDeviceId: "device_first_approver",
      })
      .expect(200);

    // Lookup of already approved session returns HTTP 409 Conflict
    const lookupRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/pin/${linkingPin}`)
      .set("Cookie", alice.cookies)
      .expect(409);

    assert.match(
      lookupRes.body?.message?.toLowerCase() || "",
      /already.*used/,
      "Lookup must return 'already used' message",
    );

    // Another approver attempting to approve returns HTTP 409 Conflict
    const approveRes = await request(app)
      .post("/api/v1/e2ee/devices/link/approve")
      .set("Cookie", alice.cookies)
      .send({
        linkSessionId,
        encryptedPayload: { ciphertext: "payload2", iv: "iv2" },
        approverDeviceId: "device_different_approver",
      })
      .expect(409);

    assert.match(
      approveRes.body?.message?.toLowerCase() || "",
      /already.*used/,
      "Approve must return 'already used' message",
    );
  });

  await teardownTestEnvironment();
});
