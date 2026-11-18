import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import User from "../src/modules/users/models/users.model.js";
import { createAndLoginUsers } from "./auth-helper.js";

const subtle = globalThis.crypto?.subtle;
const ECDH = { name: "ECDH", namedCurve: "P-256" };
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (str) => new Uint8Array(Buffer.from(str, "base64"));
const randomIv = () => crypto.getRandomValues(new Uint8Array(12));

async function createIdentity() {
  const pair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await subtle.exportKey("jwk", pair.privateKey);
  return { pair, publicJwk, privateJwk };
}

async function createEncryptedBackup(privateJwk, passphrase, version = 1) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const derivedKey = await subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const plainBytes = enc.encode(JSON.stringify(privateJwk));
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv },
    derivedKey,
    plainBytes,
  );
  const envelope = {
    version,
    algorithm: "AES-256-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: 600000,
    salt: b64(salt),
    iv: b64(iv),
    ciphertext: b64(ct),
  };
  return JSON.stringify(envelope);
}

// Client helper: decrypt private key using PBKDF2 + AES-GCM
async function decryptEncryptedBackup(envelopeJson, passphrase) {
  const env = JSON.parse(envelopeJson);
  const salt = unb64(env.salt);
  const iv = unb64(env.iv);
  const ct = unb64(env.ciphertext);
  const baseKey = await subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const derivedKey = await subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: env.iterations || 600000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await subtle.decrypt(
    { name: "AES-GCM", iv },
    derivedKey,
    ct,
  );
  return JSON.parse(dec.decode(decrypted));
}

test("Priority 4: E2EE Recovery, Device Revocation & Key Rotation Suite", async (t) => {
  const env = await setupTestEnvironment();
  const app = env.app;
  const users = await createAndLoginUsers(app, env.port);

  const alice = users.alice;
  const bob = users.bob;
  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);

  // Unset pre-seeded dummy keys from test-env so Alice starts uninitialized
  await User.updateOne(
    { _id: aliceId },
    { $unset: { publicKey: 1, publicKeyUpdatedAt: 1, encryptedPrivateKey: 1, e2eeBackupVersion: 1 } },
  );

  const recoverySecret1 = "PrimaryRecoveryHorseBatteryStaple123!";
  const recoverySecret2 = "RotatedSecurePassphrase456!";

  // Create Alice identity
  const aliceInitial = await createIdentity();
  const aliceBackupV1 = await createEncryptedBackup(
    aliceInitial.privateJwk,
    recoverySecret1,
    1,
  );

  await t.test(
    "1. Reject Plaintext Private Key Upload: Never store unencrypted private keys on server",
    async () => {
      // Attempt to register initial keys with unencrypted private key JWK (containing 'd')
      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: aliceInitial.publicJwk,
          encryptedPrivateKey: JSON.stringify(aliceInitial.privateJwk), // Unencrypted! Contains 'd'
          backupVersion: 1,
        })
        .expect(400);

      assert.match(
        res.body?.message || "",
        /Plaintext private keys must never be transmitted/,
      );
    },
  );

  await t.test(
    "2. Reject Malformed Backup: Envelope missing required cryptographic fields",
    async () => {
      const malformedEnvelope = JSON.stringify({
        version: 1,
        algorithm: "AES-256-GCM",
        // missing salt, iv, ciphertext!
      });

      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: aliceInitial.publicJwk,
          encryptedPrivateKey: malformedEnvelope,
          backupVersion: 1,
        })
        .expect(400);

      assert.match(
        res.body?.message || "",
        /Encrypted backup envelope is missing required cryptographic fields/,
      );
    },
  );

  await t.test(
    "3. Initial Key & Encrypted Backup Registration succeeds with valid envelope",
    async () => {
      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: aliceInitial.publicJwk,
          encryptedPrivateKey: aliceBackupV1,
          backupVersion: 1,
        })
        .expect(201);

      assert.equal(res.body.data.hasPublicKey, true);
      assert.equal(res.body.data.hasBackup, true);
      assert.equal(res.body.data.backupVersion, 1);

      // Register Alice Device 1
      await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "alice-device-1",
          publicKey: aliceInitial.publicJwk,
          deviceName: "Alice MacBook",
        })
        .expect(201);
    },
  );

  await t.test(
    "4. Unauthorized Backup Access: Unauthenticated request rejected with 401",
    async () => {
      await request(app).get("/api/v1/e2ee/backup").expect(401);
    },
  );

  await t.test("5. Lost Device Recovery on New Device (Device 2)", async () => {
    // Alice gets a new phone (Device 2) and fetches the encrypted backup
    const backupRes = await request(app)
      .get("/api/v1/e2ee/backup")
      .set("Cookie", alice.cookies)
      .expect(200);

    const remoteBackup = backupRes.body.data;
    assert.ok(remoteBackup.encryptedPrivateKey);
    assert.equal(remoteBackup.backupVersion, 1);

    // Decrypt backup on Device 2 using recovery secret
    const recoveredPrivateJwk = await decryptEncryptedBackup(
      remoteBackup.encryptedPrivateKey,
      recoverySecret1,
    );
    assert.equal(recoveredPrivateJwk.kty, "EC");
    assert.equal(recoveredPrivateJwk.crv, "P-256");
    assert.equal(recoveredPrivateJwk.x, aliceInitial.publicJwk.x);
    assert.equal(recoveredPrivateJwk.y, aliceInitial.publicJwk.y);
    assert.equal(recoveredPrivateJwk.d, aliceInitial.privateJwk.d);

    // Device 2 registers its active presence
    const dev2Res = await request(app)
      .post("/api/v1/e2ee/devices")
      .set("Cookie", alice.cookies)
      .send({
        deviceId: "alice-device-2-phone",
        publicKey: {
          kty: "EC",
          crv: "P-256",
          x: recoveredPrivateJwk.x,
          y: recoveredPrivateJwk.y,
        },
        deviceName: "Alice iPhone",
      })
      .expect(201);

    assert.equal(dev2Res.body.data.deviceId, "alice-device-2-phone");
  });

  await t.test(
    "6. Wrong Recovery Password fails AES-GCM tag authentication",
    async () => {
      const backupRes = await request(app)
        .get("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies)
        .expect(200);

      await assert.rejects(async () => {
        await decryptEncryptedBackup(
          backupRes.body.data.encryptedPrivateKey,
          "WrongPassword123!",
        );
      }, /operation|tag|decrypt/i);
    },
  );

  await t.test(
    "7. Update Backup & Passphrase Rotation: Updates backup version cleanly",
    async () => {
      // Alice rotates her recovery secret to recoverySecret2
      const aliceBackupV2 = await createEncryptedBackup(
        aliceInitial.privateJwk,
        recoverySecret2,
        2,
      );

      const updateRes = await request(app)
        .put("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies)
        .send({
          encryptedPrivateKey: aliceBackupV2,
          backupVersion: 2,
          expectedVersion: 1,
        })
        .expect(200);

      assert.equal(updateRes.body.data.hasBackup, true);
      assert.equal(updateRes.body.data.backupVersion, 2);

      // Verify recovery secret 2 decrypts
      const fetched = await request(app)
        .get("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies)
        .expect(200);

      const restoredJwk = await decryptEncryptedBackup(
        fetched.body.data.encryptedPrivateKey,
        recoverySecret2,
      );
      assert.equal(restoredJwk.d, aliceInitial.privateJwk.d);
    },
  );

  await t.test(
    "8. Prevent Stale Backup Overwrite & Optimistic Concurrency",
    async () => {
      const staleBackup = await createEncryptedBackup(
        aliceInitial.privateJwk,
        "StaleSecret",
        1,
      );

      // Attempting to overwrite version 2 with version 1 -> 409 Conflict
      const res = await request(app)
        .put("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies)
        .send({
          encryptedPrivateKey: staleBackup,
          backupVersion: 1,
        })
        .expect(409);

      assert.match(
        res.body?.message || "",
        /Cannot overwrite newer backup version/,
      );
    },
  );

  await t.test(
    "9. Device Revocation: Lost device is revoked and excluded from future key distribution",
    async () => {
      // Alice marks Device 1 (MacBook) as lost/compromised and revokes it
      const revokeRes = await request(app)
        .delete("/api/v1/e2ee/devices/alice-device-1")
        .set("Cookie", alice.cookies)
        .expect(200);

      assert.equal(revokeRes.body.data.revoked, true);
      assert.equal(revokeRes.body.data.deviceId, "alice-device-1");

      // Active devices lookup only returns Device 2
      const activeRes = await request(app)
        .get("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .expect(200);

      const activeList = activeRes.body.data.devices;
      assert.equal(activeList.length, 1);
      assert.equal(activeList[0].deviceId, "alice-device-2-phone");
      assert.equal(activeList[0].isRevoked, false);

      // IncludeRevoked returns both active and revoked devices
      const allRes = await request(app)
        .get("/api/v1/e2ee/devices?includeRevoked=true")
        .set("Cookie", alice.cookies)
        .expect(200);

      const allList = allRes.body.data.devices;
      assert.equal(allList.length, 2);
      const dev1 = allList.find((d) => d.deviceId === "alice-device-1");
      assert.equal(dev1.isRevoked, true);
    },
  );

  await t.test(
    "10. Revoked Device Action Rejection: Cannot re-register, heartbeat, or update backup",
    async () => {
      // 10a: Revoked device cannot re-register (403)
      await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "alice-device-1",
          publicKey: aliceInitial.publicJwk,
        })
        .expect(403);

      // 10b: Revoked device cannot heartbeat (403)
      await request(app)
        .post("/api/v1/e2ee/devices/heartbeat")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "alice-device-1",
        })
        .expect(403);

      // 10c: Revoked device cannot update backup (403)
      const backupV3 = await createEncryptedBackup(
        aliceInitial.privateJwk,
        recoverySecret2,
        3,
      );
      await request(app)
        .put("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies)
        .send({
          encryptedPrivateKey: backupV3,
          backupVersion: 3,
          deviceId: "alice-device-1",
        })
        .expect(403);

      // 10d: Revoked device cannot rotate keys (403)
      const newKey = await createIdentity();
      await request(app)
        .post("/api/v1/e2ee/devices/rotate")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "alice-device-1",
          newPublicKey: newKey.publicJwk,
        })
        .expect(403);
    },
  );

  await t.test(
    "11. Device Key Rotation: Active device can rotate its cryptographic key",
    async () => {
      // Alice Device 2 rotates its EC key
      const rotatedKey = await createIdentity();

      const rotateRes = await request(app)
        .post("/api/v1/e2ee/devices/rotate")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "alice-device-2-phone",
          newPublicKey: rotatedKey.publicJwk,
          deviceName: "Alice iPhone (Rotated Key)",
        })
        .expect(200);

      assert.equal(rotateRes.body.data.rotated, true);
      assert.equal(rotateRes.body.data.deviceId, "alice-device-2-phone");
      assert.equal(rotateRes.body.data.publicKey.x, rotatedKey.publicJwk.x);

      // Senders fetching public keys get the updated rotated key
      const pubRes = await request(app)
        .post("/api/v1/e2ee/devices/public-keys")
        .set("Cookie", bob.cookies)
        .send({ userIds: [aliceId] })
        .expect(200);

      const aliceDevices = pubRes.body.data.userDevices[aliceId];
      assert.equal(aliceDevices.length, 1);
      assert.equal(aliceDevices[0].deviceId, "alice-device-2-phone");
      assert.equal(aliceDevices[0].publicKey.x, rotatedKey.publicJwk.x);
    },
  );

  await teardownTestEnvironment();
});
