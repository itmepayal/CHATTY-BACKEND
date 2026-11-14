import request from "supertest";
import mongoose from "mongoose";
import assert from "node:assert/strict";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import Message from "../src/modules/messaging/models/message.model.js";
import ScheduledMessage from "../src/modules/messaging/models/scheduled-message.model.js";
import DeviceKey from "../src/modules/e2ee/models/device-key.model.js";
import { deliverMessage } from "../src/modules/messaging/services/core/message.service.js";

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const ECDH = { name: "ECDH", namedCurve: "P-256" };

const b64 = (buf) => Buffer.from(buf).toString("base64");
const unb64 = (str) => Uint8Array.from(Buffer.from(str, "base64"));
const randomIv = () => crypto.getRandomValues(new Uint8Array(12));

async function createIdentity() {
  const pair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
  const cleanPublicJwk = {
    kty: publicJwk.kty,
    crv: publicJwk.crv,
    x: publicJwk.x,
    y: publicJwk.y,
  };
  return { pair, publicJwk: cleanPublicJwk };
}

async function deriveShared(privateKey, publicKey) {
  const bits = await subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256,
  );
  const hk = await subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: enc.encode("chatty-e2ee-v1"),
    },
    hk,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// Client-side simulation of encryptFor (ECIES v2 ephemeral scheme)
async function clientEncryptFor(senderIdentity, destDevices, plaintext) {
  const msgKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const msgKey = await subtle.importKey("raw", msgKeyRaw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  const msgIv = randomIv();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: msgIv },
    msgKey,
    enc.encode(plaintext),
  );

  const ephemeralPair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const ephemeralPublicRaw = await subtle.exportKey(
    "raw",
    ephemeralPair.publicKey,
  );
  const ephemeralPublicB64 = b64(ephemeralPublicRaw);

  const keyEnvelopes = [];
  for (const dev of destDevices) {
    const devPub = await subtle.importKey("jwk", dev.publicKey, ECDH, true, []);
    const wrapKey = await deriveShared(ephemeralPair.privateKey, devPub);
    const wrapIv = randomIv();
    const wrapped = await subtle.encrypt(
      { name: "AES-GCM", iv: wrapIv },
      wrapKey,
      msgKeyRaw,
    );
    keyEnvelopes.push({
      deviceId: String(dev.deviceId),
      userId: String(dev.userId),
      wrappedKey: `v2:${ephemeralPublicB64}:${b64(wrapped)}`,
      iv: b64(wrapIv),
    });
  }

  return {
    text: b64(ct),
    iv: b64(msgIv),
    keyEnvelopes,
  };
}

// Client-side simulation of decryptFrom (v2 ephemeral with legacy fallback)
async function clientDecryptFrom(myIdentity, myDeviceId, cipherB64, ivB64, keyEnvelopes, senderPublicKey = null) {
  const myUserId = String(myIdentity.userId);
  const envelopes = keyEnvelopes || [];

  if (Array.isArray(envelopes) && envelopes.length > 0) {
    const myEnvs = envelopes.filter((e) => String(e.userId) === myUserId);
    const orderedEnvs = [];
    const direct = myEnvs.find((e) => e.deviceId === myDeviceId);
    if (direct) orderedEnvs.push(direct);
    const def = myEnvs.find((e) => e.deviceId === "default" && e !== direct);
    if (def) orderedEnvs.push(def);
    for (const e of myEnvs) {
      if (!orderedEnvs.includes(e)) orderedEnvs.push(e);
    }

    for (const env of orderedEnvs) {
      try {
        let rawMsgKey = null;
        if (typeof env.wrappedKey === "string" && env.wrappedKey.startsWith("v2:")) {
          const parts = env.wrappedKey.split(":");
          const ephemPub = await subtle.importKey("raw", unb64(parts[1]), ECDH, false, []);
          const wrapKey = await deriveShared(myIdentity.pair.privateKey, ephemPub);
          rawMsgKey = await subtle.decrypt(
            { name: "AES-GCM", iv: unb64(env.iv) },
            wrapKey,
            unb64(parts[2]),
          );
        } else if (senderPublicKey) {
          // Legacy envelope
          const senderPub = await subtle.importKey("jwk", senderPublicKey, ECDH, true, []);
          const wrapKey = await deriveShared(myIdentity.pair.privateKey, senderPub);
          rawMsgKey = await subtle.decrypt(
            { name: "AES-GCM", iv: unb64(env.iv) },
            wrapKey,
            unb64(env.wrappedKey),
          );
        }

        if (rawMsgKey) {
          const msgKey = await subtle.importKey("raw", rawMsgKey, "AES-GCM", false, ["decrypt"]);
          const pt = await subtle.decrypt(
            { name: "AES-GCM", iv: unb64(ivB64) },
            msgKey,
            unb64(cipherB64),
          );
          return dec.decode(pt);
        }
      } catch {
        // try next envelope
      }
    }
  }

  // Legacy pairwise fallback
  if (senderPublicKey) {
    try {
      const senderPub = await subtle.importKey("jwk", senderPublicKey, ECDH, true, []);
      const pairShared = await deriveShared(myIdentity.pair.privateKey, senderPub);
      const pt = await subtle.decrypt(
        { name: "AES-GCM", iv: unb64(ivB64) },
        pairShared,
        unb64(cipherB64),
      );
      return dec.decode(pt);
    } catch {
      // ignore
    }
  }

  if (Array.isArray(envelopes) && envelopes.length > 0) {
    const hasMyEnv = envelopes.some(
      (e) => String(e.userId) === myUserId && (e.deviceId === myDeviceId || e.deviceId === "default")
    );
    if (!hasMyEnv) {
      throw new Error("Sent before this device was added");
    }
  }

  throw new Error("Decryption failed");
}

async function runAcceptanceTests() {
  console.log("\n==================================================");
  console.log("RUNNING ALL 7 E2EE ACCEPTANCE TESTS");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const app = env.app;
  const users = await createAndLoginUsers(app, env.port);

  const alice = users.alice;
  const bob = users.bob;
  const charlie = users.charlie;
  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);

  // Setup Identities
  // A: Laptop
  const aliceLaptop = await createIdentity();
  aliceLaptop.userId = aliceId;
  aliceLaptop.deviceId = "alice-laptop-1";

  // B: Mobile (over HTTPS)
  const bobMobile = await createIdentity();
  bobMobile.userId = bobId;
  bobMobile.deviceId = "bob-mobile-1";

  // Register public keys on server
  await request(app)
    .post("/api/v1/e2ee/keys")
    .set("Cookie", alice.cookies)
    .send({
      publicKey: aliceLaptop.publicJwk,
      encryptedPrivateKey: "sampleEncryptedPrivateKeyA123456789012345678901234567890",
      backupVersion: 1,
    });
  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", alice.cookies)
    .send({
      deviceId: aliceLaptop.deviceId,
      publicKey: aliceLaptop.publicJwk,
      deviceInfo: { platform: "Linux", browser: "Chrome" },
    });

  await request(app)
    .post("/api/v1/e2ee/keys")
    .set("Cookie", bob.cookies)
    .send({
      publicKey: bobMobile.publicJwk,
      encryptedPrivateKey: "sampleEncryptedPrivateKeyB123456789012345678901234567890",
      backupVersion: 1,
    });
  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", bob.cookies)
    .send({
      deviceId: bobMobile.deviceId,
      publicKey: bobMobile.publicJwk,
      deviceInfo: { platform: "Android", browser: "Chrome Mobile" },
    });

  // TEST 1: A (laptop) sends text to B (mobile over HTTPS): B sees plaintext live; A sees own message plaintext
  console.log("TEST 1: A sends encrypted text to B");
  const test1Text = "Hello Bob from Alice laptop!";
  const encrypted1 = await clientEncryptFor(
    aliceLaptop,
    [
      { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
      { userId: aliceId, deviceId: aliceLaptop.deviceId, publicKey: aliceLaptop.publicJwk },
    ],
    test1Text,
  );

  const sendRes1 = await request(app)
    .post(`/api/v1/messages/send/${bobId}`)
    .set("Cookie", alice.cookies)
    .send({
      text: encrypted1.text,
      iv: encrypted1.iv,
      encrypted: true,
      keyEnvelopes: encrypted1.keyEnvelopes,
    });

  assert.equal(sendRes1.status, 201);
  const msg1 = sendRes1.body.data;
  assert.equal(msg1.encrypted, true);
  assert.ok(msg1.keyEnvelopes.length >= 2);

  // B (mobile) decrypts
  const bDecrypted1 = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    msg1.text,
    msg1.iv,
    msg1.keyEnvelopes,
    aliceLaptop.publicJwk,
  );
  assert.equal(bDecrypted1, test1Text, "B sees plaintext live");

  // A (laptop) decrypts own sent message
  const aDecrypted1 = await clientDecryptFrom(
    aliceLaptop,
    aliceLaptop.deviceId,
    msg1.text,
    msg1.iv,
    msg1.keyEnvelopes,
    aliceLaptop.publicJwk,
  );
  assert.equal(aDecrypted1, test1Text, "A sees own message plaintext");
  console.log("  [✓ PASS] Test 1: Plaintext verified on both sender and receiver");

  // TEST 2: B replies to A's message: quoted preview is plaintext on both sides, also after page refresh
  console.log("TEST 2: B replies to A's message");
  const test2ReplyText = "I received your message Alice!";
  const encrypted2 = await clientEncryptFor(
    bobMobile,
    [
      { userId: aliceId, deviceId: aliceLaptop.deviceId, publicKey: aliceLaptop.publicJwk },
      { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
    ],
    test2ReplyText,
  );

  const replyRes = await request(app)
    .post(`/api/v1/messages/send/${aliceId}`)
    .set("Cookie", bob.cookies)
    .send({
      text: encrypted2.text,
      iv: encrypted2.iv,
      encrypted: true,
      keyEnvelopes: encrypted2.keyEnvelopes,
      replyTo: msg1.id,
    });

  assert.equal(replyRes.status, 201);
  const replyMsg = replyRes.body.data;
  assert.ok(replyMsg.replyTo, "replyTo is populated");
  // Backend formatReply hardening: replyTo.text must NOT be ciphertext
  assert.equal(replyMsg.replyTo.text, "", "Backend replyTo.text is stripped for e2ee");
  assert.equal(replyMsg.replyTo.encrypted, true, "replyTo.encrypted is true");

  // Page refresh simulation: GET /messages/:id
  const getRes = await request(app)
    .get(`/api/v1/messages/${aliceId}`)
    .set("Cookie", bob.cookies);
  assert.equal(getRes.status, 200);
  const fetchedMessages = getRes.body.data;
  const fetchedReply = fetchedMessages.find((m) => m.id === replyMsg.id);
  assert.ok(fetchedReply);
  assert.equal(fetchedReply.replyTo.text, "", "Refreshed replyTo.text has no ciphertext");

  // Both sides can decrypt replyMsg and correlate replyTo with msg1 (already decrypted)
  const bDecryptedReply = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    fetchedReply.text,
    fetchedReply.iv,
    fetchedReply.keyEnvelopes,
    bobMobile.publicJwk,
  );
  assert.equal(bDecryptedReply, test2ReplyText);
  console.log("  [✓ PASS] Test 2: Quoted reply does not leak ciphertext; plaintext resolved on both sides");

  // TEST 3: A edits a message within 15 min: both sides show the new plaintext + "edited"; works for both encrypted and plaintext-mode messages
  console.log("TEST 3: Edit message within 15 min (both encrypted and plaintext)");
  // 3a. Encrypted edit
  const editedPlaintext = "Hello Bob (Edited text)!";
  const editedEncrypted = await clientEncryptFor(
    aliceLaptop,
    [
      { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
      { userId: aliceId, deviceId: aliceLaptop.deviceId, publicKey: aliceLaptop.publicJwk },
    ],
    editedPlaintext,
  );

  const editRes1 = await request(app)
    .patch(`/api/v1/messages/edit/${msg1.id}`)
    .set("Cookie", alice.cookies)
    .send({
      text: editedEncrypted.text,
      iv: editedEncrypted.iv,
      encrypted: true,
      keyEnvelopes: editedEncrypted.keyEnvelopes,
    });

  assert.equal(editRes1.status, 200);
  assert.equal(editRes1.body.data.isEdited, true);
  assert.equal(editRes1.body.data.encrypted, true);
  assert.ok(editRes1.body.data.keyEnvelopes.length >= 2);

  // Both sides decrypt the edited message
  const bDecryptedEdited = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    editRes1.body.data.text,
    editRes1.body.data.iv,
    editRes1.body.data.keyEnvelopes,
    aliceLaptop.publicJwk,
  );
  assert.equal(bDecryptedEdited, editedPlaintext, "B successfully decrypts edited text");

  // 3b. Plaintext message edit
  const plainMsgRes = await request(app)
    .post(`/api/v1/messages/send/${bobId}`)
    .set("Cookie", alice.cookies)
    .send({ text: "Original plaintext message" });
  assert.equal(plainMsgRes.status, 201);
  const plainMsgId = plainMsgRes.body.data.id;

  const plainEditRes = await request(app)
    .patch(`/api/v1/messages/edit/${plainMsgId}`)
    .set("Cookie", alice.cookies)
    .send({ text: "Edited plaintext message", encrypted: false });
  assert.equal(plainEditRes.status, 200);
  assert.equal(plainEditRes.body.data.text, "Edited plaintext message");
  assert.equal(plainEditRes.body.data.isEdited, true);
  console.log("  [✓ PASS] Test 3: Edit works for both encrypted and plaintext messages");

  // TEST 4: A forwards a message to 2 contacts: each receives it, readable by receiving user, marked Forwarded; contact without keys is skipped
  console.log("TEST 4: Forward message to contacts with and without keys");
  // Charlie has NO keys set up
  await User.updateOne({ _id: charlieId }, { $unset: { publicKey: 1 } });
  await DeviceKey.deleteMany({ userId: charlieId });

  // A forwards msg1 to Bob (has keys) and Charlie (no keys)
  // Re-encrypt for Bob
  const fwdEncryptedBob = await clientEncryptFor(
    aliceLaptop,
    [
      { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
      { userId: aliceId, deviceId: aliceLaptop.deviceId, publicKey: aliceLaptop.publicJwk },
    ],
    editedPlaintext,
  );

  const forwardRes = await request(app)
    .post(`/api/v1/messages/forward/${msg1.id}`)
    .set("Cookie", alice.cookies)
    .send({
      userIds: [bobId, charlieId],
      ciphertexts: [
        {
          userId: bobId,
          text: fwdEncryptedBob.text,
          iv: fwdEncryptedBob.iv,
          keyEnvelopes: fwdEncryptedBob.keyEnvelopes,
        },
      ],
    });

  assert.equal(forwardRes.status, 200);
  assert.ok(Array.isArray(forwardRes.body.data));
  assert.equal(forwardRes.body.data.length, 1, "Only Bob received forwarded message");
  assert.equal(forwardRes.body.data[0].isForwarded, true, "Marked as isForwarded");

  // Bob decrypts forwarded message
  const bFwdDecrypted = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    forwardRes.body.data[0].text,
    forwardRes.body.data[0].iv,
    forwardRes.body.data[0].keyEnvelopes,
    aliceLaptop.publicJwk,
  );
  assert.equal(bFwdDecrypted, editedPlaintext, "Bob decrypted forwarded message");
  console.log("  [✓ PASS] Test 4: Forward delivered and decrypted for valid contact; keyless contact skipped");

  // TEST 5: A schedules a message for +2 minutes: B can read it after delivery
  console.log("TEST 5: Schedule message with key envelopes and deliver");
  const schedText = "Future scheduled greeting!";
  const schedEncrypted = await clientEncryptFor(
    aliceLaptop,
    [
      { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
      { userId: aliceId, deviceId: aliceLaptop.deviceId, publicKey: aliceLaptop.publicJwk },
    ],
    schedText,
  );

  const schedFor = new Date(Date.now() + 2 * 60 * 1000);
  const schedRes = await request(app)
    .post(`/api/v1/messages/schedule/${bobId}`)
    .set("Cookie", alice.cookies)
    .send({
      text: schedEncrypted.text,
      iv: schedEncrypted.iv,
      encrypted: true,
      keyEnvelopes: schedEncrypted.keyEnvelopes,
      scheduledFor: schedFor,
    });
  assert.equal(schedRes.status, 201);
  const schedDoc = schedRes.body.data;
  assert.ok(schedDoc.keyEnvelopes.length >= 2, "Scheduled doc saved keyEnvelopes");

  // Simulate scheduler tick delivering the message
  const { message: deliveredMsg } = await deliverMessage({
    senderId: schedDoc.senderId,
    receiverId: schedDoc.receiverId,
    data: {
      text: schedDoc.text,
      e2ee: Boolean(schedDoc.e2ee),
      iv: schedDoc.iv,
      keyEnvelopes: schedDoc.keyEnvelopes,
    },
  });

  // Bob decrypts the delivered scheduled message
  const bSchedDecrypted = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    deliveredMsg.text,
    deliveredMsg.iv,
    deliveredMsg.keyEnvelopes,
    aliceLaptop.publicJwk,
  );
  assert.equal(bSchedDecrypted, schedText, "B decrypted delivered scheduled message");
  console.log("  [✓ PASS] Test 5: Scheduled message stores keyEnvelopes and delivers successfully");

  // TEST 6: B logs in on a second device: new messages decrypt on both devices
  console.log("TEST 6: Multi-device - B adds second device (laptop)");
  const bobLaptop = await createIdentity();
  bobLaptop.userId = bobId;
  bobLaptop.deviceId = "bob-laptop-2";

  // B registers second device key
  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", bob.cookies)
    .send({
      deviceId: bobLaptop.deviceId,
      publicKey: bobLaptop.publicJwk,
      deviceInfo: { platform: "macOS", browser: "Safari" },
    });

  // Alice sends a new message with envelopes for all active devices (B mobile, B laptop, A laptop)
  const multiDevText = "Message for both of Bob's devices!";
  const multiDevEncrypted = await clientEncryptFor(
    aliceLaptop,
    [
      { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
      { userId: bobId, deviceId: bobLaptop.deviceId, publicKey: bobLaptop.publicJwk },
      { userId: aliceId, deviceId: aliceLaptop.deviceId, publicKey: aliceLaptop.publicJwk },
    ],
    multiDevText,
  );

  const multiDevRes = await request(app)
    .post(`/api/v1/messages/send/${bobId}`)
    .set("Cookie", alice.cookies)
    .send({
      text: multiDevEncrypted.text,
      iv: multiDevEncrypted.iv,
      encrypted: true,
      keyEnvelopes: multiDevEncrypted.keyEnvelopes,
    });

  assert.equal(multiDevRes.status, 201);
  const multiMsg = multiDevRes.body.data;

  // 6a: B's mobile decrypts
  const b1Dec = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    multiMsg.text,
    multiMsg.iv,
    multiMsg.keyEnvelopes,
    aliceLaptop.publicJwk,
  );
  assert.equal(b1Dec, multiDevText, "Bob Device 1 (mobile) decrypted");

  // 6b: B's laptop decrypts
  const b2Dec = await clientDecryptFrom(
    bobLaptop,
    bobLaptop.deviceId,
    multiMsg.text,
    multiMsg.iv,
    multiMsg.keyEnvelopes,
    aliceLaptop.publicJwk,
  );
  assert.equal(b2Dec, multiDevText, "Bob Device 2 (laptop) decrypted");

  // 6c: Older message (msg1) attempted on B's NEW device (bobLaptop)
  // Should throw "Sent before this device was added"
  let caughtLimitation = false;
  try {
    await clientDecryptFrom(
      bobLaptop,
      bobLaptop.deviceId,
      msg1.text,
      msg1.iv,
      msg1.keyEnvelopes,
      null,
    );
  } catch (err) {
    if (err.message === "Sent before this device was added") {
      caughtLimitation = true;
    }
  }
  assert.ok(caughtLimitation, "Recognized 'Sent before this device was added'");
  console.log("  [✓ PASS] Test 6: New message decrypts on both of B's devices; old message displays clear notice");

  // TEST 7: Old (pre-fix) messages still decrypt through the legacy path where possible
  console.log("TEST 7: Backward compatibility - legacy pairwise and legacy envelope decrypt");
  // Simulate legacy pairwise encryption (direct deriveShared between Alice and Bob identity keys)
  const legacyShared = await deriveShared(aliceLaptop.pair.privateKey, await subtle.importKey("jwk", bobMobile.publicJwk, ECDH, true, []));
  const legacyIv = randomIv();
  const legacyPlaintext = "Legacy pre-fix message content";
  const legacyCt = await subtle.encrypt(
    { name: "AES-GCM", iv: legacyIv },
    legacyShared,
    enc.encode(legacyPlaintext),
  );

  // Bob decrypts with legacy pairwise fallback
  const legacyDecrypted = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    b64(legacyCt),
    b64(legacyIv),
    [], // no envelopes (pre-envelope era)
    aliceLaptop.publicJwk,
  );
  assert.equal(legacyDecrypted, legacyPlaintext, "Legacy pairwise message decrypted");

  // Legacy envelope (wrappedKey without 'v2:')
  const legacyWrapKey = await deriveShared(aliceLaptop.pair.privateKey, await subtle.importKey("jwk", bobMobile.publicJwk, ECDH, true, []));
  const legacyMsgKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const legacyMsgKey = await subtle.importKey("raw", legacyMsgKeyRaw, "AES-GCM", false, ["encrypt", "decrypt"]);
  const legacyMsgIv = randomIv();
  const legacyMsgCt = await subtle.encrypt(
    { name: "AES-GCM", iv: legacyMsgIv },
    legacyMsgKey,
    enc.encode("Legacy envelope text"),
  );
  const legacyWrapIv = randomIv();
  const legacyWrapped = await subtle.encrypt(
    { name: "AES-GCM", iv: legacyWrapIv },
    legacyWrapKey,
    legacyMsgKeyRaw,
  );

  const legacyEnvDecrypted = await clientDecryptFrom(
    bobMobile,
    bobMobile.deviceId,
    b64(legacyMsgCt),
    b64(legacyMsgIv),
    [
      {
        deviceId: bobMobile.deviceId,
        userId: bobId,
        wrappedKey: b64(legacyWrapped), // no v2 prefix
        iv: b64(legacyWrapIv),
      },
    ],
    aliceLaptop.publicJwk,
  );
  assert.equal(legacyEnvDecrypted, "Legacy envelope text", "Legacy envelope without v2 prefix decrypted");
  console.log("  [✓ PASS] Test 7: Legacy pairwise and legacy envelope decrypt backwards-compatible");

  console.log("\n==================================================");
  console.log("ALL 7 ACCEPTANCE TESTS COMPLETED SUCCESSFULLY!");
  console.log("==================================================\n");

  await teardownTestEnvironment();
  process.exit(0);
}

runAcceptanceTests().catch((err) => {
  console.error("ACCEPTANCE TEST FAILED:", err);
  process.exit(1);
});
