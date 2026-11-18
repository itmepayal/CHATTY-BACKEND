import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
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
  const publicRaw = await subtle.exportKey("raw", pair.publicKey);
  return { pair, publicJwk, publicRaw };
}

async function clientEncryptFor(senderIdentity, devices, plaintext) {
  const msgKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const msgKey = await subtle.importKey("raw", msgKeyRaw, "AES-GCM", false, ["encrypt"]);
  const msgIv = randomIv();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: msgIv },
    msgKey,
    enc.encode(plaintext),
  );

  const ephemeralPair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const ephemPubRaw = await subtle.exportKey("raw", ephemeralPair.publicKey);
  const ephemPubB64 = b64(ephemPubRaw);

  const keyEnvelopes = [];
  for (const dev of devices) {
    const devPub = await subtle.importKey("jwk", dev.publicKey, ECDH, false, []);
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

async function clientDecryptFrom(myIdentity, myDeviceId, cipherB64, ivB64, envelopes) {
  const myUserId = String(myIdentity.userId);
  const myEnvs = (envelopes || []).filter((e) => String(e.userId) === myUserId);
  const targetEnvs = myEnvs.filter((e) => e.deviceId === myDeviceId || e.deviceId === "default");

  if (targetEnvs.length === 0) {
    throw new Error("Sent before this device was added");
  }

  for (const env of targetEnvs) {
    try {
      const parts = env.wrappedKey.split(":");
      const ephemPub = await subtle.importKey("raw", unb64(parts[1]), ECDH, false, []);
      const bits = await subtle.deriveBits({ name: "ECDH", public: ephemPub }, myIdentity.pair.privateKey, 256);
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
    } catch (err) {
      // try next
    }
  }

  throw new Error("Decryption failed");
}

test("Priority 3: Multi-Device Key Synchronization & Cryptographic Reliability", async (t) => {
  const env = await setupTestEnvironment();
  const app = env.app;
  const users = await createAndLoginUsers(app, env.port);

  const alice = users.alice;
  const bob = users.bob;
  const charlie = users.charlie;
  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);

  // Setup Alice Device 1
  const aliceDev1 = await createIdentity();
  aliceDev1.userId = aliceId;
  aliceDev1.deviceId = "alice-phone";

  await request(app)
    .post("/api/v1/e2ee/keys")
    .set("Cookie", alice.cookies)
    .send({
      publicKey: aliceDev1.publicJwk,
      encryptedPrivateKey: "sampleEncryptedPrivateKeyAlice11111111111111111111111111111",
      backupVersion: 1,
    });
  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", alice.cookies)
    .send({
      deviceId: aliceDev1.deviceId,
      publicKey: aliceDev1.publicJwk,
      deviceName: "Alice Phone",
    });

  // Setup Bob Device 1, Device 2, and Device 3
  const bobDev1 = await createIdentity();
  bobDev1.userId = bobId;
  bobDev1.deviceId = "bob-mobile";

  const bobDev2 = await createIdentity();
  bobDev2.userId = bobId;
  bobDev2.deviceId = "bob-laptop";

  const bobDev3 = await createIdentity();
  bobDev3.userId = bobId;
  bobDev3.deviceId = "bob-tablet";

  await request(app)
    .post("/api/v1/e2ee/keys")
    .set("Cookie", bob.cookies)
    .send({
      publicKey: bobDev1.publicJwk,
      encryptedPrivateKey: "sampleEncryptedPrivateKeyBob1111111111111111111111111111111",
      backupVersion: 1,
    });

  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", bob.cookies)
    .send({
      deviceId: bobDev1.deviceId,
      publicKey: bobDev1.publicJwk,
      deviceName: "Bob Mobile",
    });

  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", bob.cookies)
    .send({
      deviceId: bobDev2.deviceId,
      publicKey: bobDev2.publicJwk,
      deviceName: "Bob Laptop",
    });

  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", bob.cookies)
    .send({
      deviceId: bobDev3.deviceId,
      publicKey: bobDev3.publicJwk,
      deviceName: "Bob Tablet",
    });

  await t.test("1. Multi-Device Distribution: 3 devices belonging to same account independently decrypt", async () => {
    const plaintext = "Hello to all 3 of Bob's active devices!";
    const encrypted = await clientEncryptFor(
      aliceDev1,
      [
        { userId: bobId, deviceId: bobDev1.deviceId, publicKey: bobDev1.publicJwk },
        { userId: bobId, deviceId: bobDev2.deviceId, publicKey: bobDev2.publicJwk },
        { userId: bobId, deviceId: bobDev3.deviceId, publicKey: bobDev3.publicJwk },
        { userId: aliceId, deviceId: aliceDev1.deviceId, publicKey: aliceDev1.publicJwk },
      ],
      plaintext,
    );

    const sendRes = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: encrypted.text,
        iv: encrypted.iv,
        encrypted: true,
        keyEnvelopes: encrypted.keyEnvelopes,
      })
      .expect(201);

    const msg = sendRes.body.data;
    assert.equal(msg.encrypted, true);
    assert.equal(msg.keyEnvelopes.length, 4);

    // Verify Bob Dev 1 decrypts
    const d1 = await clientDecryptFrom(bobDev1, bobDev1.deviceId, msg.text, msg.iv, msg.keyEnvelopes);
    assert.equal(d1, plaintext, "Bob Dev 1 decrypted");

    // Verify Bob Dev 2 decrypts
    const d2 = await clientDecryptFrom(bobDev2, bobDev2.deviceId, msg.text, msg.iv, msg.keyEnvelopes);
    assert.equal(d2, plaintext, "Bob Dev 2 decrypted");

    // Verify Bob Dev 3 decrypts
    const d3 = await clientDecryptFrom(bobDev3, bobDev3.deviceId, msg.text, msg.iv, msg.keyEnvelopes);
    assert.equal(d3, plaintext, "Bob Dev 3 decrypted");

    // Verify Alice Dev 1 (sender) decrypts own sent message
    const a1 = await clientDecryptFrom(aliceDev1, aliceDev1.deviceId, msg.text, msg.iv, msg.keyEnvelopes);
    assert.equal(a1, plaintext, "Alice Dev 1 decrypted");
  });

  await t.test("2. Cross-User Envelope Isolation: Reject envelope containing third-party userId", async () => {
    const encrypted = await clientEncryptFor(
      aliceDev1,
      [
        { userId: bobId, deviceId: bobDev1.deviceId, publicKey: bobDev1.publicJwk },
        { userId: charlieId, deviceId: "charlie-dev", publicKey: bobDev1.publicJwk }, // Unauthorized user in DM!
      ],
      "Cross-user attack text",
    );

    const res = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: encrypted.text,
        iv: encrypted.iv,
        encrypted: true,
        keyEnvelopes: encrypted.keyEnvelopes,
      })
      .expect(400);

    assert.match(res.body?.message || "", /Unauthorized user in key envelopes/);
  });

  await t.test("3. Missing Recipient Envelope: Reject encrypted message with no envelopes for recipient", async () => {
    const encrypted = await clientEncryptFor(
      aliceDev1,
      [
        { userId: aliceId, deviceId: aliceDev1.deviceId, publicKey: aliceDev1.publicJwk },
      ],
      "Missing recipient envelope test",
    );

    const res = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: encrypted.text,
        iv: encrypted.iv,
        encrypted: true,
        keyEnvelopes: encrypted.keyEnvelopes,
      })
      .expect(400);

    assert.match(res.body?.message || "", /Key envelope for recipient is required/);
  });

  await t.test("4. Static Fallback Device ID Rejection: Disallow 'device-session-fallback' in envelopes", async () => {
    const encrypted = await clientEncryptFor(
      aliceDev1,
      [
        { userId: bobId, deviceId: "device-session-fallback", publicKey: bobDev1.publicJwk },
      ],
      "Static fallback test",
    );

    const res = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: encrypted.text,
        iv: encrypted.iv,
        encrypted: true,
        keyEnvelopes: encrypted.keyEnvelopes,
      })
      .expect(400);

    assert.match(res.body?.message || "", /Static fallback device ID is not permitted/);
  });

  await t.test("5. Envelope Deduplication: Duplicate envelopes for same (userId, deviceId) are deduplicated", async () => {
    const encrypted = await clientEncryptFor(
      aliceDev1,
      [
        { userId: bobId, deviceId: bobDev1.deviceId, publicKey: bobDev1.publicJwk },
        { userId: bobId, deviceId: bobDev1.deviceId, publicKey: bobDev1.publicJwk }, // duplicate
        { userId: aliceId, deviceId: aliceDev1.deviceId, publicKey: aliceDev1.publicJwk },
      ],
      "Deduplication test",
    );

    const res = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: encrypted.text,
        iv: encrypted.iv,
        encrypted: true,
        keyEnvelopes: encrypted.keyEnvelopes,
      })
      .expect(201);

    // Exactly 2 envelopes stored (1 for Bob Dev 1, 1 for Alice Dev 1)
    assert.equal(res.body.data.keyEnvelopes.length, 2);
  });

  await t.test("6. Silent Key Replacement Rejection: Cannot silently change public key on active device (409 Conflict)", async () => {
    const impostorKey = await createIdentity();

    const res = await request(app)
      .post("/api/v1/e2ee/devices")
      .set("Cookie", bob.cookies)
      .send({
        deviceId: bobDev1.deviceId, // active device
        publicKey: impostorKey.publicJwk, // different key
        deviceName: "Impostor Replacement",
      })
      .expect(409);

    assert.match(res.body?.message || "", /Device identity key cannot be replaced for an active device/);
  });

  await t.test("7. Tampered Ciphertext Rejection: Corrupting ciphertext fails AES-GCM tag verification", async () => {
    const plaintext = "Integrity check test message";
    const encrypted = await clientEncryptFor(
      aliceDev1,
      [
        { userId: bobId, deviceId: bobDev1.deviceId, publicKey: bobDev1.publicJwk },
      ],
      plaintext,
    );

    // Tamper with the ciphertext by flipping bytes
    const ctBytes = unb64(encrypted.text);
    ctBytes[0] ^= 0xff; // flip bits of first byte
    const tamperedCipher = b64(ctBytes);

    await assert.rejects(
      async () => {
        await clientDecryptFrom(bobDev1, bobDev1.deviceId, tamperedCipher, encrypted.iv, encrypted.keyEnvelopes);
      },
      /Decryption failed/,
    );
  });

  await t.test("8. Tampered Envelope IV Rejection: Corrupted envelope IV prevents key recovery", async () => {
    const plaintext = "Envelope IV tampering test";
    const encrypted = await clientEncryptFor(
      aliceDev1,
      [
        { userId: bobId, deviceId: bobDev1.deviceId, publicKey: bobDev1.publicJwk },
      ],
      plaintext,
    );

    // Tamper envelope IV
    const tamperedEnvelopes = encrypted.keyEnvelopes.map((e) => {
      const ivBytes = unb64(e.iv);
      ivBytes[0] ^= 0xff;
      return { ...e, iv: b64(ivBytes) };
    });

    await assert.rejects(
      async () => {
        await clientDecryptFrom(bobDev1, bobDev1.deviceId, encrypted.text, encrypted.iv, tamperedEnvelopes);
      },
      /Decryption failed/,
    );
  });

  await t.test("9. Newly Linked Device: Older historical messages safely throw 'Sent before this device was added'", async () => {
    // Bob adds Device 4 later
    const bobDev4 = await createIdentity();
    bobDev4.userId = bobId;
    bobDev4.deviceId = "bob-desktop";

    // Message sent before Device 4 was registered (only had envelopes for Dev 1, 2, 3)
    const oldEnvelopes = [
      { userId: bobId, deviceId: bobDev1.deviceId, wrappedKey: "v2:abc:def", iv: b64(randomIv()) },
      { userId: bobId, deviceId: bobDev2.deviceId, wrappedKey: "v2:abc:def", iv: b64(randomIv()) },
    ];

    await assert.rejects(
      async () => {
        await clientDecryptFrom(bobDev4, bobDev4.deviceId, b64(new Uint8Array(32)), b64(randomIv()), oldEnvelopes);
      },
      (err) => {
        assert.equal(err.message, "Sent before this device was added");
        return true;
      },
    );
  });

  await teardownTestEnvironment();
});
