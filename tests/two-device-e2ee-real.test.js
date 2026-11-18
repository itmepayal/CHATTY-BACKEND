import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";

const subtle = globalThis.crypto?.subtle;
const ECDH_ALGO = { name: "ECDH", namedCurve: "P-256" };
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (str) => new Uint8Array(Buffer.from(str, "base64"));
const randomIv = () => crypto.getRandomValues(new Uint8Array(12));

/**
 * Generate a real ECDH P-256 identity keypair with extractable keys for testing.
 */
async function createIdentity() {
  const pair = await subtle.generateKey(ECDH_ALGO, true, ["deriveBits", "deriveKey"]);
  const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await subtle.exportKey("jwk", pair.privateKey);
  const publicRaw = await subtle.exportKey("raw", pair.publicKey);
  return { pair, publicJwk, privateJwk, publicRaw };
}

/**
 * Generate ephemeral ECDH P-256 keypair for device linking session.
 */
async function createEphemeralLinkPair() {
  const pair = await subtle.generateKey(ECDH_ALGO, true, ["deriveBits", "deriveKey"]);
  const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
  return { pair, publicJwk };
}

/**
 * Encrypt a link payload (privateJwk + recoveryKey) from Approver to Target Device.
 */
async function encryptLinkPayload(approverPrivateKey, approverPublicJwk, targetEphemeralPublicJwk, payloadObj) {
  const targetKey = await subtle.importKey("jwk", targetEphemeralPublicJwk, ECDH_ALGO, false, []);
  const sharedKey = await subtle.deriveKey(
    { name: "ECDH", public: targetKey },
    approverPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  const iv = randomIv();
  const payloadBytes = enc.encode(JSON.stringify(payloadObj));
  const cipherBuf = await subtle.encrypt({ name: "AES-GCM", iv }, sharedKey, payloadBytes);

  return {
    ephemeralPublicKey: {
      kty: "EC",
      crv: "P-256",
      x: approverPublicJwk.x,
      y: approverPublicJwk.y,
    },
    iv: b64(iv),
    ciphertext: b64(cipherBuf),
  };
}

/**
 * Decrypt a link payload on Target Device using Target Ephemeral Private Key.
 */
async function decryptLinkPayload(targetPrivateKey, approverEphemeralPublicJwk, ivB64, cipherB64) {
  const approverKey = await subtle.importKey("jwk", approverEphemeralPublicJwk, ECDH_ALGO, false, []);
  const sharedKey = await subtle.deriveKey(
    { name: "ECDH", public: approverKey },
    targetPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const decryptedBuf = await subtle.decrypt(
    { name: "AES-GCM", iv: unb64(ivB64) },
    sharedKey,
    unb64(cipherB64),
  );

  return JSON.parse(dec.decode(decryptedBuf));
}

/**
 * Encrypt message text and multi-device key envelopes for all target devices.
 */
async function clientEncryptFor(senderIdentity, devices, plaintext) {
  const msgKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const msgKey = await subtle.importKey("raw", msgKeyRaw, "AES-GCM", false, ["encrypt"]);
  const msgIv = randomIv();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: msgIv },
    msgKey,
    enc.encode(plaintext),
  );

  const ephemeralPair = await subtle.generateKey(ECDH_ALGO, true, ["deriveBits"]);
  const ephemPubRaw = await subtle.exportKey("raw", ephemeralPair.publicKey);
  const ephemPubB64 = b64(ephemPubRaw);

  const keyEnvelopes = [];
  for (const dev of devices) {
    const devPub = await subtle.importKey("jwk", dev.publicKey, ECDH_ALGO, false, []);
    const bits = await subtle.deriveBits({ name: "ECDH", public: devPub }, ephemeralPair.privateKey, 256);
    const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
    const wrapKey = await subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("chatty-e2ee-v1") },
      hk,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const wrapIv = randomIv();
    const wrapped = await subtle.encrypt(
      { name: "AES-GCM", iv: wrapIv },
      wrapKey,
      msgKeyRaw,
    );
    keyEnvelopes.push({
      deviceId: String(dev.deviceId),
      userId: String(dev.userId),
      wrappedKey: `v2:${ephemPubB64}:${b64(wrapped)}`,
      iv: b64(wrapIv),
    });
  }

  return {
    text: b64(ct),
    iv: b64(msgIv),
    keyEnvelopes,
  };
}

/**
 * Decrypt message using private key matching my device.
 */
async function clientDecryptFrom(myPrivateKey, myUserId, myDeviceId, cipherB64, ivB64, envelopes) {
  const myEnvs = (envelopes || []).filter((e) => String(e.userId) === String(myUserId));
  const targetEnvs = myEnvs.filter((e) => e.deviceId === myDeviceId || e.deviceId === "default");

  if (targetEnvs.length === 0) {
    throw new Error(`Sent before device ${myDeviceId} was added or no envelope for device`);
  }

  for (const env of targetEnvs) {
    try {
      const parts = env.wrappedKey.split(":");
      const ephemPub = await subtle.importKey("raw", unb64(parts[1]), ECDH_ALGO, false, []);
      const bits = await subtle.deriveBits({ name: "ECDH", public: ephemPub }, myPrivateKey, 256);
      const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
      const wrapKey = await subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("chatty-e2ee-v1") },
        hk,
        { name: "AES-GCM", length: 256 },
        false,
        ["decrypt"],
      );
      const rawMsgKey = await subtle.decrypt(
        { name: "AES-GCM", iv: unb64(env.iv) },
        wrapKey,
        unb64(parts[2]),
      );
      const msgKey = await subtle.importKey("raw", rawMsgKey, "AES-GCM", false, ["decrypt"]);
      const pt = await subtle.decrypt(
        { name: "AES-GCM", iv: unb64(ivB64) },
        msgKey,
        unb64(cipherB64),
      );
      return dec.decode(pt);
    } catch {
      // try next envelope
    }
  }

  throw new Error("Decryption failed across all matching envelopes");
}

test("Real Two-Device E2EE Integration Test: Full Lifecycle", async (t) => {
  const env = await setupTestEnvironment();
  const app = env.app;
  const users = await createAndLoginUsers(app, env.port);

  const alice = users.alice;
  const bob = users.bob;
  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);

  // Storage for Device A (Alice Desktop - Trusted)
  let deviceA = null;
  const deviceADeviceId = "alice_desktop_macbook";
  const aliceRecoveryKey = "correct-battery-horse-staple-recovery-key-999";

  // Storage for Device B (Alice Mobile - New Device to be Linked)
  let deviceBEphem = null;
  let linkSessionId = null;
  let linkingPin = null;
  const deviceBDeviceId = "alice_iphone_15_pro";
  let deviceBRecoveredIdentity = null;

  // Storage for Bob's Identity
  let bobIdentity = null;
  const bobDeviceId = "bob_pixel_8";

  await t.test("1. Setup Alice Trusted Device A & Key Registration", async () => {
    // Clear any seeded mock keys from test runner fixture to start with pristine E2EE state
    await User.updateMany({}, {
      $unset: {
        publicKey: 1,
        publicKeyUpdatedAt: 1,
        e2eeBackup: 1,
        e2eeBackupVersion: 1,
        e2eeBackupUpdatedAt: 1,
      },
    });

    deviceA = await createIdentity();
    deviceA.userId = aliceId;
    deviceA.deviceId = deviceADeviceId;

    // Register identity keys and backup on server
    await request(app)
      .post("/api/v1/e2ee/keys")
      .set("Cookie", alice.cookies)
      .send({
        publicKey: deviceA.publicJwk,
        encryptedPrivateKey: "sampleEncryptedBackupBlobForAliceKeys1234567890",
        backupVersion: 1,
      })
      .expect(201);

    // Register Device A in device registry
    const regRes = await request(app)
      .post("/api/v1/e2ee/devices")
      .set("Cookie", alice.cookies)
      .send({
        deviceId: deviceA.deviceId,
        publicKey: deviceA.publicJwk,
        deviceName: "Alice's MacBook Pro (macOS)",
      })
      .expect(201);

    assert.equal(regRes.body?.data?.deviceId, deviceADeviceId);
    assert.equal(regRes.body?.data?.deviceName, "Alice's MacBook Pro (macOS)");

    // Setup Bob's identity for messaging tests
    bobIdentity = await createIdentity();
    bobIdentity.userId = bobId;
    bobIdentity.deviceId = bobDeviceId;

    await request(app)
      .post("/api/v1/e2ee/keys")
      .set("Cookie", bob.cookies)
      .send({
        publicKey: bobIdentity.publicJwk,
        encryptedPrivateKey: "sampleEncryptedBackupBlobForBobKeys1234567890",
        backupVersion: 1,
      })
      .expect(201);

    await request(app)
      .post("/api/v1/e2ee/devices")
      .set("Cookie", bob.cookies)
      .send({
        deviceId: bobIdentity.deviceId,
        publicKey: bobIdentity.publicJwk,
        deviceName: "Bob's Pixel 8 (Android)",
      })
      .expect(201);
  });

  await t.test("2. Device B initiates linking: generates ephemeral ECDH pair & requests link session", async () => {
    // Device B generates an ephemeral ECDH keypair
    deviceBEphem = await createEphemeralLinkPair();

    const reqRes = await request(app)
      .post("/api/v1/e2ee/devices/link/request")
      .set("Cookie", alice.cookies)
      .send({
        ephemeralPublicKey: deviceBEphem.publicJwk,
        deviceId: deviceBDeviceId,
        deviceName: "Alice's iPhone 15 Pro (iOS)",
      })
      .expect(201);

    assert.ok(reqRes.body?.data?.linkSessionId, "Must return linkSessionId");
    assert.ok(reqRes.body?.data?.linkingPin, "Must return 6-digit linkingPin");
    assert.match(reqRes.body.data.linkingPin, /^\d{6}$/, "PIN must be exactly 6 digits");
    assert.ok(reqRes.body?.data?.expiresAt, "Must have expiration timestamp");

    linkSessionId = reqRes.body.data.linkSessionId;
    linkingPin = reqRes.body.data.linkingPin;

    // Verify QR code payload format
    const qrPayload = `chatty-link:${linkSessionId}:${linkingPin}`;
    assert.ok(qrPayload.startsWith("chatty-link:"));
    const qrParts = qrPayload.split(":");
    assert.equal(qrParts[1], linkSessionId);
    assert.equal(qrParts[2], linkingPin);
  });

  await t.test("3. Device A scans QR / enters PIN and looks up pending session", async () => {
    // Normalization check: user enters "123-456" or " 123 456 " with formatting
    const formattedPin = `${linkingPin.slice(0, 3)}-${linkingPin.slice(3)}`;
    const normalizedPin = formattedPin.replace(/[\s-]+/g, "");

    const lookupRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/pin/${normalizedPin}`)
      .set("Cookie", alice.cookies)
      .expect(200);

    const sessionData = lookupRes.body?.data;
    assert.equal(sessionData.linkSessionId, linkSessionId);
    assert.equal(sessionData.linkingPin, linkingPin);
    assert.equal(sessionData.newDeviceId, deviceBDeviceId);
    assert.equal(sessionData.newDeviceName, "Alice's iPhone 15 Pro (iOS)");
    assert.equal(sessionData.ephemeralPublicKey.kty, "EC");
    assert.equal(sessionData.ephemeralPublicKey.crv, "P-256");
    assert.equal(sessionData.ephemeralPublicKey.x, deviceBEphem.publicJwk.x);
    assert.equal(sessionData.ephemeralPublicKey.y, deviceBEphem.publicJwk.y);
  });

  await t.test("4. Device A performs ECDH key exchange, encrypts identity keys, and approves session", async () => {
    // Device A generates an ephemeral key pair for the handshake
    const approverEphem = await createEphemeralLinkPair();

    // Device A encrypts Alice's privateJwk and recoveryKey for Device B using WebCrypto ECDH + AES-GCM
    const encryptedPayload = await encryptLinkPayload(
      approverEphem.pair.privateKey,
      approverEphem.publicJwk,
      deviceBEphem.publicJwk,
      {
        privateJwk: deviceA.privateJwk,
        recoveryKey: aliceRecoveryKey,
      },
    );

    assert.ok(encryptedPayload.ephemeralPublicKey?.x, "Approver ephemeral public key must be present");
    assert.ok(encryptedPayload.iv, "IV must be present");
    assert.ok(encryptedPayload.ciphertext, "Ciphertext must be present");

    // Device A calls approve endpoint
    const approveRes = await request(app)
      .post("/api/v1/e2ee/devices/link/approve")
      .set("Cookie", alice.cookies)
      .send({
        linkSessionId,
        encryptedPayload,
        approverDeviceId: deviceADeviceId,
      })
      .expect(200);

    assert.equal(approveRes.body?.data?.success, true);
    assert.equal(approveRes.body?.data?.linkSessionId, linkSessionId);
  });

  await t.test("5. Device B retrieves status, decrypts payload, verifies private key, and registers device", async () => {
    // Device B polls for session status
    const statusRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/status/${linkSessionId}`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(statusRes.body?.data?.status, "approved");
    const payloadFromServer = statusRes.body?.data?.encryptedPayload;
    assert.ok(payloadFromServer);

    // Device B decrypts the payload using its ephemeral private key
    const decryptedPayload = await decryptLinkPayload(
      deviceBEphem.pair.privateKey,
      payloadFromServer.ephemeralPublicKey,
      payloadFromServer.iv,
      payloadFromServer.ciphertext,
    );

    assert.ok(decryptedPayload.privateJwk, "Must recover privateJwk");
    assert.equal(decryptedPayload.recoveryKey, aliceRecoveryKey, "Must recover recoveryKey");

    // Verify recovered private key matches Device A's public key (same identity!)
    assert.equal(decryptedPayload.privateJwk.x, deviceA.publicJwk.x);
    assert.equal(decryptedPayload.privateJwk.y, deviceA.publicJwk.y);
    assert.equal(decryptedPayload.privateJwk.crv, "P-256");
    assert.ok(decryptedPayload.privateJwk.d, "Must have private exponent d");

    // Import recovered private key on Device B
    const deviceBPrivateKey = await subtle.importKey(
      "jwk",
      decryptedPayload.privateJwk,
      ECDH_ALGO,
      false,
      ["deriveBits", "deriveKey"],
    );

    deviceBRecoveredIdentity = {
      privateKey: deviceBPrivateKey,
      publicJwk: deviceA.publicJwk,
      deviceId: deviceBDeviceId,
      userId: aliceId,
    };

    // Device B registers in Device Registry with its own deviceId
    const regRes = await request(app)
      .post("/api/v1/e2ee/devices")
      .set("Cookie", alice.cookies)
      .send({
        deviceId: deviceBDeviceId,
        publicKey: deviceA.publicJwk,
        deviceName: "Alice's iPhone 15 Pro (iOS)",
      })
      .expect(201);

    assert.equal(regRes.body?.data?.deviceId, deviceBDeviceId);
  });

  await t.test("6. Multi-Device Messaging: Bob queries Alice's devices and sends message encrypted for BOTH devices", async () => {
    // Bob fetches Alice's active devices
    const devRes = await request(app)
      .post("/api/v1/e2ee/devices/public-keys")
      .set("Cookie", bob.cookies)
      .send({ userIds: [aliceId] })
      .expect(200);

    const aliceDevices = devRes.body?.data?.userDevices?.[aliceId] || [];
    assert.equal(aliceDevices.length, 2, "Alice must have both Device A and Device B active");

    const foundDevA = aliceDevices.find((d) => d.deviceId === deviceADeviceId);
    const foundDevB = aliceDevices.find((d) => d.deviceId === deviceBDeviceId);
    assert.ok(foundDevA, "Device A must be returned");
    assert.ok(foundDevB, "Device B must be returned");

    // Bob creates message encrypted for Alice Dev A, Alice Dev B, and Bob
    const secretText = "Hello Alice! This secret message should appear simultaneously on your Mac and iPhone.";
    const encrypted = await clientEncryptFor(
      bobIdentity,
      [
        { userId: aliceId, deviceId: deviceADeviceId, publicKey: foundDevA.publicKey },
        { userId: aliceId, deviceId: deviceBDeviceId, publicKey: foundDevB.publicKey },
        { userId: bobId, deviceId: bobDeviceId, publicKey: bobIdentity.publicJwk },
      ],
      secretText,
    );

    const sendRes = await request(app)
      .post(`/api/v1/messages/send/${aliceId}`)
      .set("Cookie", bob.cookies)
      .send({
        text: encrypted.text,
        iv: encrypted.iv,
        encrypted: true,
        keyEnvelopes: encrypted.keyEnvelopes,
      })
      .expect(201);

    const msg = sendRes.body?.data;
    assert.equal(msg.encrypted, true);
    assert.equal(msg.keyEnvelopes.length, 3);

    // 1. Device A (MacBook) decrypts message successfully
    const decryptedByDevA = await clientDecryptFrom(
      deviceA.pair.privateKey,
      aliceId,
      deviceADeviceId,
      msg.text,
      msg.iv,
      msg.keyEnvelopes,
    );
    assert.equal(decryptedByDevA, secretText, "Device A must decrypt the exact message");

    // 2. Device B (iPhone) decrypts message successfully using the synchronized key
    const decryptedByDevB = await clientDecryptFrom(
      deviceBRecoveredIdentity.privateKey,
      aliceId,
      deviceBDeviceId,
      msg.text,
      msg.iv,
      msg.keyEnvelopes,
    );
    assert.equal(decryptedByDevB, secretText, "Device B must decrypt the exact message");

    // 3. Bob decrypts his own sent copy
    const decryptedByBob = await clientDecryptFrom(
      bobIdentity.pair.privateKey,
      bobId,
      bobDeviceId,
      msg.text,
      msg.iv,
      msg.keyEnvelopes,
    );
    assert.equal(decryptedByBob, secretText, "Bob must decrypt his own sent message");
  });

  await t.test("7. Device B sends an encrypted reply back to Bob", async () => {
    // Fetch Bob's devices
    const bobDevRes = await request(app)
      .post("/api/v1/e2ee/devices/public-keys")
      .set("Cookie", alice.cookies)
      .send({ userIds: [bobId] })
      .expect(200);

    const bobDevices = bobDevRes.body?.data?.userDevices?.[bobId] || [];
    assert.ok(bobDevices.length >= 1);

    const replyText = "Awesome Bob! I received it on my new iPhone!";
    const encryptedReply = await clientEncryptFor(
      deviceBRecoveredIdentity,
      [
        { userId: bobId, deviceId: bobDeviceId, publicKey: bobIdentity.publicJwk },
        { userId: aliceId, deviceId: deviceBDeviceId, publicKey: deviceA.publicJwk },
        { userId: aliceId, deviceId: deviceADeviceId, publicKey: deviceA.publicJwk },
      ],
      replyText,
    );

    const sendReplyRes = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: encryptedReply.text,
        iv: encryptedReply.iv,
        encrypted: true,
        keyEnvelopes: encryptedReply.keyEnvelopes,
      })
      .expect(201);

    const replyMsg = sendReplyRes.body?.data;

    // Bob decrypts Alice's reply
    const decryptedReply = await clientDecryptFrom(
      bobIdentity.pair.privateKey,
      bobId,
      bobDeviceId,
      replyMsg.text,
      replyMsg.iv,
      replyMsg.keyEnvelopes,
    );
    assert.equal(decryptedReply, replyText, "Bob must decrypt reply from Device B");
  });

  await t.test("8. Revocation: Device A revokes Device B; Bob stops sending envelopes to Device B", async () => {
    // Device A revokes Device B
    const revokeRes = await request(app)
      .delete(`/api/v1/e2ee/devices/${deviceBDeviceId}`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(revokeRes.body?.data?.revoked, true);

    // Bob re-queries Alice's devices -> Device B is no longer returned
    const refreshedDevsRes = await request(app)
      .post("/api/v1/e2ee/devices/public-keys")
      .set("Cookie", bob.cookies)
      .send({ userIds: [aliceId] })
      .expect(200);

    const activeAliceDevices = refreshedDevsRes.body?.data?.userDevices?.[aliceId] || [];
    assert.equal(activeAliceDevices.length, 1, "Only 1 active device should remain for Alice");
    assert.equal(activeAliceDevices[0].deviceId, deviceADeviceId);
    assert.ok(!activeAliceDevices.some((d) => d.deviceId === deviceBDeviceId), "Device B must not be present");

    // Bob sends a new confidential message with envelopes for active devices only
    const postRevokeText = "Secret message after Device B was revoked.";
    const encryptedPostRevoke = await clientEncryptFor(
      bobIdentity,
      [
        { userId: aliceId, deviceId: deviceADeviceId, publicKey: deviceA.publicJwk },
        { userId: bobId, deviceId: bobDeviceId, publicKey: bobIdentity.publicJwk },
      ],
      postRevokeText,
    );

    const postRevokeSendRes = await request(app)
      .post(`/api/v1/messages/send/${aliceId}`)
      .set("Cookie", bob.cookies)
      .send({
        text: encryptedPostRevoke.text,
        iv: encryptedPostRevoke.iv,
        encrypted: true,
        keyEnvelopes: encryptedPostRevoke.keyEnvelopes,
      })
      .expect(201);

    const postRevokeMsg = postRevokeSendRes.body?.data;

    // Device A can decrypt
    const devADecrypt = await clientDecryptFrom(
      deviceA.pair.privateKey,
      aliceId,
      deviceADeviceId,
      postRevokeMsg.text,
      postRevokeMsg.iv,
      postRevokeMsg.keyEnvelopes,
    );
    assert.equal(devADecrypt, postRevokeText);

    // Device B cannot decrypt (has no envelope)
    await assert.rejects(
      async () => {
        await clientDecryptFrom(
          deviceBRecoveredIdentity.privateKey,
          aliceId,
          deviceBDeviceId,
          postRevokeMsg.text,
          postRevokeMsg.iv,
          postRevokeMsg.keyEnvelopes,
        );
      },
      /Sent before device alice_iphone_15_pro was added or no envelope for device/,
      "Device B must not be able to decrypt messages sent after revocation",
    );
  });

  await teardownTestEnvironment();
});
