import request from "supertest";
import mongoose from "mongoose";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers, TEST_PASSWORD } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import GroupKey from "../src/modules/groups/models/group-key.model.js";

const e2eeTestResults = [];

function recordResult(category, description, expected, actual, pass) {
  e2eeTestResults.push({ category, description, expected, actual, pass });
  const mark = pass ? "[✓ PASS]" : "[✗ FAIL]";
  console.log(`${mark} [${category}] ${description}`);
  if (!pass) {
    console.error(`       Expected: ${JSON.stringify(expected)}`);
    console.error(`       Actual:   ${JSON.stringify(actual)}`);
  }
}

const samplePublicKeyA = {
  kty: "EC",
  crv: "P-256",
  x: "W98p5T6W61qJ1KjY64EwUoZl9cO2L5mG3uV6x7y8z9A",
  y: "N12o3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H2",
};

const samplePublicKeyB = {
  kty: "EC",
  crv: "P-256",
  x: "B98p5T6W61qJ1KjY64EwUoZl9cO2L5mG3uV6x7y8z9B",
  y: "M12o3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H3",
};

const sampleEncryptedPrivateKey = "aW5pdGlhbEVuY3J5cHRlZFByaXZhdGVLZXlUZXN0RGF0YTEyMzQ1Ng==";
const sampleUpdatedBackup = "dXBkYXRlZEVuY3J5cHRlZFByaXZhdGVLZXlUZXN0RGF0YTY1NDMyMQ==";

async function runE2EETests() {
  console.log("\n==================================================");
  console.log("Starting Production-Ready Multi-Device E2EE Test Suite");
  console.log("==================================================\n");

  let app, users;

  try {
    const env = await setupTestEnvironment();
    app = env.app;
    users = await createAndLoginUsers(app, env.port);

    const alice = users.alice;
    const bob = users.bob;
    const charlie = users.charlie;
    const aliceId = String(alice.user._id);
    const bobId = String(bob.user._id);
    const charlieId = String(charlie.user._id);

    // Reset keys on alice, bob, charlie so we start with clean slate
    await User.updateMany({}, {
      $unset: {
        publicKey: 1,
        encryptedPrivateKey: 1,
        publicKeyUpdatedAt: 1,
        e2eeBackupVersion: 1,
        e2eeBackupUpdatedAt: 1,
      },
    });

    console.log("--- Category 1: Status Endpoint (/api/v1/e2ee/status & /api/e2ee/status) ---");

    // 1.1 Unauthenticated request returns 401
    {
      const res = await request(app).get("/api/v1/e2ee/status");
      const pass = res.status === 401;
      recordResult("Status", "Unauthenticated request rejected with 401", 401, res.status, pass);
    }

    // 1.2 Fresh user hasKey=false, hasBackup=false
    {
      const res = await request(app)
        .get("/api/v1/e2ee/status")
        .set("Cookie", alice.cookies);
      const data = res.body?.data;
      const pass = res.status === 200 &&
        data?.hasKey === false &&
        data?.hasBackup === false &&
        data?.backupVersion === null;
      recordResult("Status", "User without keys returns hasKey=false and hasBackup=false", true, pass, pass);
    }

    // 1.3 Route alias without /v1 returns same shape
    {
      const res = await request(app)
        .get("/api/e2ee/status")
        .set("Cookie", alice.cookies);
      const pass = res.status === 200 && res.body?.data?.hasKey === false;
      recordResult("Status", "Route alias /api/e2ee/status behaves identically", 200, res.status, pass);
    }

    console.log("\n--- Category 2: Key Registration & Idempotency (/api/v1/e2ee/keys) ---");

    // 2.1 Invalid public key rejected (400)
    {
      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: { kty: "RSA", n: "invalid" },
          encryptedPrivateKey: sampleEncryptedPrivateKey,
        });
      const pass = res.status === 400;
      recordResult("Registration", "Invalid public key schema rejected with 400", 400, res.status, pass);
    }

    // 2.2 Backup too small (<16 bytes) rejected (400)
    {
      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: samplePublicKeyA,
          encryptedPrivateKey: "short",
        });
      const pass = res.status === 400;
      recordResult("Registration", "Undersized backup rejected with 400", 400, res.status, pass);
    }

    // 2.3 Valid initial registration
    {
      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: samplePublicKeyA,
          encryptedPrivateKey: sampleEncryptedPrivateKey,
        });
      const data = res.body?.data;
      const pass = (res.status === 201 || res.status === 200) &&
        data?.hasKey === true &&
        data?.hasBackup === true &&
        data?.backupVersion === 1;
      recordResult("Registration", "Valid initial key registration returns 201/200 with backupVersion 1", true, pass, pass);
    }

    // 2.4 Verify database fields and select: false protection
    {
      const userRaw = await User.findById(aliceId);
      const userSelected = await User.findById(aliceId).select("+publicKey +encryptedPrivateKey +e2eeBackupVersion");
      const pass = userRaw.publicKey === undefined &&
        userRaw.encryptedPrivateKey === undefined &&
        userSelected.publicKey?.x === samplePublicKeyA.x &&
        userSelected.encryptedPrivateKey === sampleEncryptedPrivateKey &&
        userSelected.e2eeBackupVersion === 1;
      recordResult("Database Security", "Keys are select:false and safely stored in database", true, pass, pass);
    }

    // 2.5 Re-registration with SAME public key is idempotent
    {
      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: samplePublicKeyA,
          encryptedPrivateKey: sampleEncryptedPrivateKey,
        });
      const pass = res.status === 200 && res.body?.data?.hasKey === true;
      recordResult("Registration", "Re-registration with identical public key is idempotent (200)", 200, res.status, pass);
    }

    // 2.6 Registration with CONFLICTING public key returns 409
    {
      const res = await request(app)
        .post("/api/v1/e2ee/keys")
        .set("Cookie", alice.cookies)
        .send({
          publicKey: samplePublicKeyB,
          encryptedPrivateKey: sampleEncryptedPrivateKey,
        });
      const pass = res.status === 409;
      recordResult("Registration", "Registration with conflicting public key rejected with 409 Conflict", 409, res.status, pass);
    }

    console.log("\n--- Category 3: Encrypted Backup Retrieval & Update (/api/v1/e2ee/backup) ---");

    // 3.1 User with backup retrieves encrypted backup (200)
    {
      const res = await request(app)
        .get("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies);
      const data = res.body?.data;
      const pass = res.status === 200 &&
        data?.encryptedPrivateKey === sampleEncryptedPrivateKey &&
        data?.backupVersion === 1 &&
        data?.backupUpdatedAt !== null;
      recordResult("Backup", "GET /api/v1/e2ee/backup returns encrypted backup and version", true, pass, pass);
    }

    // 3.2 User without backup receives 404
    {
      const res = await request(app)
        .get("/api/v1/e2ee/backup")
        .set("Cookie", bob.cookies);
      const pass = res.status === 404;
      recordResult("Backup", "GET /api/v1/e2ee/backup returns 404 for user with no backup", 404, res.status, pass);
    }

    // 3.3 Update backup increments backup version
    {
      const res = await request(app)
        .put("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies)
        .send({ encryptedPrivateKey: sampleUpdatedBackup });
      const data = res.body?.data;
      const pass = res.status === 200 &&
        data?.backupVersion === 2 &&
        data?.hasBackup === true;
      recordResult("Backup", "PUT /api/v1/e2ee/backup increments backupVersion to 2", 2, data?.backupVersion, pass);
    }

    // 3.4 Verify retrieved backup has the updated ciphertext
    {
      const res = await request(app)
        .get("/api/v1/e2ee/backup")
        .set("Cookie", alice.cookies);
      const pass = res.status === 200 && res.body?.data?.encryptedPrivateKey === sampleUpdatedBackup;
      recordResult("Backup", "Subsequent GET /backup reflects updated ciphertext", true, pass, pass);
    }

    console.log("\n--- Category 4: Public Key Retrieval (/api/v1/messages/e2ee & /api/e2ee) ---");

    // 4.1 Bob registers his keys
    await request(app)
      .post("/api/v1/e2ee/keys")
      .set("Cookie", bob.cookies)
      .send({
        publicKey: samplePublicKeyB,
        encryptedPrivateKey: sampleEncryptedPrivateKey,
      });

    // 4.2 Fetch public key via /api/v1/messages/e2ee/public-key/:id
    {
      const res = await request(app)
        .get(`/api/v1/messages/e2ee/public-key/${aliceId}`)
        .set("Cookie", bob.cookies);
      const data = res.body?.data;
      const pass = res.status === 200 &&
        data?.publicKey?.x === samplePublicKeyA.x &&
        data?.publicKey?.crv === "P-256";
      recordResult("Public Key", "GET /api/v1/messages/e2ee/public-key/:id returns JWK public key", true, pass, pass);
    }

    // 4.3 Fetch public key via /api/e2ee/public-key/:id alias
    {
      const res = await request(app)
        .get(`/api/e2ee/public-key/${aliceId}`)
        .set("Cookie", bob.cookies);
      const pass = res.status === 200 && res.body?.data?.publicKey?.x === samplePublicKeyA.x;
      recordResult("Public Key", "GET /api/e2ee/public-key/:id alias returns JWK public key", 200, res.status, pass);
    }

    // 4.4 Fetch public key for user without keys returns 404
    {
      const res = await request(app)
        .get(`/api/v1/messages/e2ee/public-key/${charlieId}`)
        .set("Cookie", alice.cookies);
      const pass = res.status === 404;
      recordResult("Public Key", "GET public-key for user without keys returns 404", 404, res.status, pass);
    }

    // 4.5 Batch fetch public keys (/api/v1/messages/e2ee/public-keys)
    {
      const res = await request(app)
        .post("/api/v1/messages/e2ee/public-keys")
        .set("Cookie", charlie.cookies)
        .send({
          userIds: [aliceId, bobId, charlieId, aliceId], // includes duplicate and user without key
        });
      const data = res.body?.data;
      const pass = res.status === 200 &&
        data?.publicKeys?.[aliceId]?.x === samplePublicKeyA.x &&
        data?.publicKeys?.[bobId]?.x === samplePublicKeyB.x &&
        data?.publicKeys?.[charlieId] === undefined &&
        data?.count === 2;
      recordResult("Batch Public Keys", "POST /public-keys deduplicates IDs and returns map of existing keys", true, pass, pass);
    }

    console.log("\n--- Category 5: Backward Compatibility Endpoints ---");

    // 5.1 Legacy GET /api/v1/users/:id/public-key
    {
      const res = await request(app)
        .get(`/api/v1/users/${aliceId}/public-key`)
        .set("Cookie", bob.cookies);
      const pass = res.status === 200 && res.body?.data?.publicKey?.x === samplePublicKeyA.x;
      recordResult("Compatibility", "Legacy GET /api/v1/users/:id/public-key returns public key", 200, res.status, pass);
    }

    // 5.2 Legacy PUT /api/v1/users/me/public-key
    {
      const res = await request(app)
        .put("/api/v1/users/me/public-key")
        .set("Cookie", charlie.cookies)
        .send({ publicKey: samplePublicKeyA });
      const pass = res.status === 200;
      recordResult("Compatibility", "Legacy PUT /api/v1/users/me/public-key succeeds", 200, res.status, pass);
    }

    console.log("\n--- Category 6: E2EE Identity Reset (/api/v1/e2ee/reset) ---");

    // Setup dummy GroupKey for alice to verify cascade deletion on reset
    const dummyGroupId = new mongoose.Types.ObjectId();
    await GroupKey.create({
      groupId: dummyGroupId,
      userId: aliceId,
      version: 1,
      wrappedKey: "wrappedAliceKey123456",
      iv: "sampleIv123456",
      wrappedBy: bobId,
    });

    // 6.1 Reset with wrong password rejected with 401
    {
      const res = await request(app)
        .post("/api/v1/e2ee/reset")
        .set("Cookie", alice.cookies)
        .send({
          password: "WrongPassword!",
          confirm: "RESET_E2EE_IDENTITY",
        });
      const pass = res.status === 401;
      recordResult("Reset", "Reset with invalid password rejected with 401", 401, res.status, pass);
    }

    // 6.2 Reset with wrong confirmation keyword rejected with 400
    {
      const res = await request(app)
        .post("/api/v1/e2ee/reset")
        .set("Cookie", alice.cookies)
        .send({
          password: TEST_PASSWORD,
          confirm: "wrong_confirmation",
        });
      const pass = res.status === 400;
      recordResult("Reset", "Reset with incorrect confirm keyword rejected with 400", 400, res.status, pass);
    }

    // 6.3 Valid reset clears keys and cascade deletes GroupKeys
    {
      const res = await request(app)
        .post("/api/v1/e2ee/reset")
        .set("Cookie", alice.cookies)
        .send({
          password: TEST_PASSWORD,
          confirm: "RESET_E2EE_IDENTITY",
        });
      
      const aliceAfter = await User.findById(aliceId).select("+publicKey +encryptedPrivateKey +e2eeBackupVersion");
      const groupKeyAfter = await GroupKey.findOne({ groupId: dummyGroupId, userId: aliceId });
      
      const pass = res.status === 200 &&
        !aliceAfter.publicKey &&
        !aliceAfter.encryptedPrivateKey &&
        (!aliceAfter.e2eeBackupVersion || aliceAfter.e2eeBackupVersion === null) &&
        groupKeyAfter === null;
      
      recordResult("Reset", "Valid reset wipes keys and cascade deletes user's GroupKey documents", true, pass, pass);
    }

    // 6.4 Status after reset reflects no keys
    {
      const res = await request(app)
        .get("/api/v1/e2ee/status")
        .set("Cookie", alice.cookies);
      const data = res.body?.data;
      const pass = res.status === 200 &&
        data?.hasKey === false &&
        data?.hasBackup === false &&
        data?.backupVersion === null;
      recordResult("Reset", "GET /status after reset confirms hasKey=false and hasBackup=false", true, pass, pass);
    }

    console.log("\n--- Category 7: Multi-Device Key Registry & Message Envelopes ---");

    const sampleDeviceKey1 = {
      kty: "EC",
      crv: "P-256",
      x: "W98p5T6W61qJ1KjY64EwUoZl9cO2L5mG3uV6x7y8z9A",
      y: "N12o3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H2",
    };
    const sampleDeviceKey2 = {
      kty: "EC",
      crv: "P-256",
      x: "C98p5T6W61qJ1KjY64EwUoZl9cO2L5mG3uV6x7y8z9C",
      y: "D12o3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H4",
    };

    // 7.1 Register Device 1 for Alice
    {
      const res = await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "alice-laptop-001",
          deviceName: "Alice MacBook Pro",
          publicKey: sampleDeviceKey1,
        });
      const data = res.body?.data;
      const pass = res.status === 201 &&
        data?.deviceId === "alice-laptop-001" &&
        data?.deviceName === "Alice MacBook Pro" &&
        data?.isRevoked === false;
      recordResult("MultiDevice", "Register device key succeeds with 201", true, pass, pass);
    }

    // 7.2 Register Device 2 for Alice
    {
      const res = await request(app)
        .post("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies)
        .send({
          deviceId: "alice-phone-002",
          deviceName: "Alice iPhone 15",
          publicKey: sampleDeviceKey2,
        });
      const pass = res.status === 201 && res.body?.data?.deviceId === "alice-phone-002";
      recordResult("MultiDevice", "Register second device for same account succeeds with 201", true, pass, pass);
    }

    // 7.3 List Alice's registered devices
    {
      const res = await request(app)
        .get("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies);
      const devices = res.body?.data?.devices;
      const pass = res.status === 200 &&
        Array.isArray(devices) &&
        devices.length === 2 &&
        devices.some((d) => d.deviceId === "alice-laptop-001") &&
        devices.some((d) => d.deviceId === "alice-phone-002");
      recordResult("MultiDevice", "List registered devices returns both active devices", true, pass, pass);
    }

    // 7.4 Batch lookup of active device public keys
    {
      const res = await request(app)
        .post("/api/v1/e2ee/devices/public-keys")
        .set("Cookie", alice.cookies)
        .send({
          userIds: [aliceId, bobId],
        });
      const data = res.body?.data;
      const pass = res.status === 200 &&
        Array.isArray(data?.devices) &&
        Array.isArray(data?.userDevices?.[aliceId]) &&
        data.userDevices[aliceId].length === 2;
      recordResult("MultiDevice", "Batch lookup of device public keys returns user device list", true, pass, pass);
    }

    // 7.5 Revoke Alice's second device
    {
      const res = await request(app)
        .delete("/api/v1/e2ee/devices/alice-phone-002")
        .set("Cookie", alice.cookies);
      const pass = res.status === 200 && res.body?.data?.revoked === true;
      recordResult("MultiDevice", "Revoke device succeeds with 200", true, pass, pass);
    }

    // 7.6 Verify revoked device is excluded from active devices list
    {
      const res = await request(app)
        .get("/api/v1/e2ee/devices")
        .set("Cookie", alice.cookies);
      const devices = res.body?.data?.devices;
      const pass = res.status === 200 &&
        devices.length === 1 &&
        devices[0].deviceId === "alice-laptop-001";
      recordResult("MultiDevice", "Revoked device excluded from active devices list", true, pass, pass);
    }

    // 7.7 Message sending with keyEnvelopes
    {
      // Register Bob's public key first so assertE2EEReady passes
      await User.findByIdAndUpdate(bobId, {
        publicKey: samplePublicKeyB,
        publicKeyUpdatedAt: new Date(),
      });
      await User.findByIdAndUpdate(aliceId, {
        publicKey: samplePublicKeyA,
        publicKeyUpdatedAt: new Date(),
      });

      const envelopes = [
        {
          deviceId: "alice-laptop-001",
          userId: aliceId,
          wrappedKey: "d3JhcHBlZEtleUZvckFsaWNlRGV2aWNlMQ==",
          iv: "aXZGb3JBbGljZTEy",
        },
        {
          deviceId: "bob-device-001",
          userId: bobId,
          wrappedKey: "d3JhcHBlZEtleUZvckJvYkRldmljZTE=",
          iv: "aXZGb3JCb2IxMjM0",
        },
      ];

      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({
          text: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB",
          iv: "AQEBAQEBAQEBAQEB",
          encrypted: true,
          keyEnvelopes: JSON.stringify(envelopes),
        });

      const payload = res.body?.data;
      const pass = res.status === 201 &&
        payload?.encrypted === true &&
        payload?.iv === "AQEBAQEBAQEBAQEB" &&
        Array.isArray(payload?.keyEnvelopes) &&
        payload.keyEnvelopes.length === 2 &&
        payload.keyEnvelopes[0].deviceId === "alice-laptop-001" &&
        payload.keyEnvelopes[1].deviceId === "bob-device-001";
      recordResult("MultiDevice", "Message sent with multi-device keyEnvelopes persists and returns envelopes", true, pass, pass);
    }

  } catch (err) {
    console.error("Unhandled error in E2EE test suite:", err);
  } finally {
    if (users) {
      for (const s of Object.values(users)) {
        if (s?.socket?.connected) s.socket.disconnect();
      }
    }
    await teardownTestEnvironment();
  }

  const passedCount = e2eeTestResults.filter((r) => r.pass).length;
  const totalCount = e2eeTestResults.length;
  console.log(`\n==================================================`);
  console.log(`E2EE TEST SUITE: Total: ${totalCount} | Passed: ${passedCount} | Failed: ${totalCount - passedCount}`);
  console.log(`==================================================\n`);

  process.exit(passedCount === totalCount ? 0 : 1);
}

runE2EETests();
