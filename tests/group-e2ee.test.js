import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import mongoose from "mongoose";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import Group from "../src/modules/groups/models/group.model.js";
import GroupKey from "../src/modules/groups/models/group-key.model.js";
import User from "../src/modules/users/models/users.model.js";
import {
  sendMessageLimiter,
  settingsLimiter,
} from "../src/middlewares/rateLimit/index.js";

const { subtle } = globalThis.crypto;
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

async function resetLimiters(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(Boolean);
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await settingsLimiter.resetKey(k);
    } catch {}
  }
}

describe("Group E2EE Key Provisioning & Encrypted Messaging Suite", () => {
  let app, port, users, alice, bob, charlie, outsider;
  let aliceId, bobId, charlieId, outsiderId;
  let aliceIdent, bobIdent, charlieIdent;

  before(async () => {
    const env = await setupTestEnvironment();
    app = env.app;
    port = env.port;
    users = await createAndLoginUsers(app, port);

    alice = users.alice;
    bob = users.bob;
    charlie = users.charlie;
    outsider = users.david;

    aliceId = String(alice.user._id);
    bobId = String(bob.user._id);
    charlieId = String(charlie.user._id);
    outsiderId = String(outsider.user._id);

    aliceIdent = await createIdentity();
    bobIdent = await createIdentity();
    charlieIdent = await createIdentity();

    // Clear initial mock publicKeys from auth-helper to allow registration,
    // clear blocked users and set groupAddPermission to "everyone" so tests can add users to groups
    await User.updateMany(
      {},
      {
        $unset: { publicKey: "", encryptedPrivateKey: "" },
        $set: { groupAddPermission: "everyone", blockedUsers: [] },
      },
    );

    // Register public keys for Alice, Bob, Charlie on server
    await request(app)
      .post("/api/v1/e2ee/keys")
      .set("Cookie", alice.cookies)
      .send({
        publicKey: aliceIdent.publicJwk,
        encryptedPrivateKey: b64(enc.encode("alice-encrypted-backup")),
      })
      .expect(201);

    await request(app)
      .post("/api/v1/e2ee/keys")
      .set("Cookie", bob.cookies)
      .send({
        publicKey: bobIdent.publicJwk,
        encryptedPrivateKey: b64(enc.encode("bob-encrypted-backup")),
      })
      .expect(201);

    await request(app)
      .post("/api/v1/e2ee/keys")
      .set("Cookie", charlie.cookies)
      .send({
        publicKey: charlieIdent.publicJwk,
        encryptedPrivateKey: b64(enc.encode("charlie-encrypted-backup")),
      })
      .expect(201);
  });

  after(async () => {
    if (alice?.socket?.connected) alice.socket.disconnect();
    if (bob?.socket?.connected) bob.socket.disconnect();
    if (charlie?.socket?.connected) charlie.socket.disconnect();
    if (outsider?.socket?.connected) outsider.socket.disconnect();
    await teardownTestEnvironment();
  });

  it("1. Rejects POST /groups/:id/keys with missing or empty keys (HTTP 400)", async () => {
    await resetLimiters(aliceId);
    // Create group with Alice & Bob
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "E2EE Test Group 1", memberIds: [bobId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    // Send empty payload
    const emptyRes = await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({})
      .expect(400);

    assert.equal(emptyRes.body.message, "Keys are required.");

    // Send empty array in keys
    const emptyArrRes = await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({ keys: [], version: 1 })
      .expect(400);

    assert.equal(emptyArrRes.body.message, "Keys are required.");
  });

  it("2. Successfully provisions group keys using { version, entries } payload format (the reported bug)", async () => {
    await resetLimiters(aliceId, bobId);
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "E2EE Entries Test", memberIds: [bobId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    // Generate raw group key
    const rawGroupKey = crypto.getRandomValues(new Uint8Array(32));

    // Alice wraps for Alice
    const sharedAlice = await deriveShared(aliceIdent.pair.privateKey, aliceIdent.pair.publicKey);
    const ivAlice = randomIv();
    const wrappedAlice = await subtle.encrypt(
      { name: "AES-GCM", iv: ivAlice },
      sharedAlice,
      rawGroupKey,
    );

    // Alice wraps for Bob
    const bobPub = await subtle.importKey("jwk", bobIdent.publicJwk, ECDH, true, []);
    const sharedBob = await deriveShared(aliceIdent.pair.privateKey, bobPub);
    const ivBob = randomIv();
    const wrappedBob = await subtle.encrypt(
      { name: "AES-GCM", iv: ivBob },
      sharedBob,
      rawGroupKey,
    );

    const entries = [
      { userId: aliceId, version: 1, wrappedKey: b64(wrappedAlice), iv: b64(ivAlice) },
      { userId: bobId, version: 1, wrappedKey: b64(wrappedBob), iv: b64(ivBob) },
    ];

    // POST with { version, entries } (the exact frontend payload format that used to fail with 400)
    const provRes = await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({ version: 1, entries })
      .expect(200);

    assert.equal(provRes.body.data.latestVersion, 1);
    assert.equal(provRes.body.data.stored, 2);

    // Verify Bob can fetch and decrypt this group key
    const bobKeysRes = await request(app)
      .get(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", bob.cookies)
      .expect(200);

    assert.equal(bobKeysRes.body.data.latestVersion, 1);
    assert.equal(bobKeysRes.body.data.keys.length, 1);
    const bobKeyData = bobKeysRes.body.data.keys[0];
    assert.equal(bobKeyData.version, 1);
    assert.equal(bobKeyData.wrappedBy, aliceId);
    assert(bobKeyData.wrapperPublicKey);

    // Bob derives shared key using wrapperPublicKey and decrypts the raw group key
    const wrapperPub = await subtle.importKey("jwk", bobKeyData.wrapperPublicKey, ECDH, true, []);
    const bobDecShared = await deriveShared(bobIdent.pair.privateKey, wrapperPub);
    const decryptedRaw = await subtle.decrypt(
      { name: "AES-GCM", iv: unb64(bobKeyData.iv) },
      bobDecShared,
      unb64(bobKeyData.wrappedKey),
    );

    assert.deepEqual(new Uint8Array(decryptedRaw), rawGroupKey);
  });

  it("3. Accepts { version, keys } and handles encryptedKey alias", async () => {
    await resetLimiters(aliceId);
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "E2EE Keys Alias Test", memberIds: [bobId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    const rawGroupKey = crypto.getRandomValues(new Uint8Array(32));
    const sharedAlice = await deriveShared(aliceIdent.pair.privateKey, aliceIdent.pair.publicKey);
    const ivAlice = randomIv();
    const wrappedAlice = await subtle.encrypt({ name: "AES-GCM", iv: ivAlice }, sharedAlice, rawGroupKey);

    const bobPub = await subtle.importKey("jwk", bobIdent.publicJwk, ECDH, true, []);
    const sharedBob = await deriveShared(aliceIdent.pair.privateKey, bobPub);
    const ivBob = randomIv();
    const wrappedBob = await subtle.encrypt({ name: "AES-GCM", iv: ivBob }, sharedBob, rawGroupKey);

    // Using keys property with encryptedKey alias
    const keys = [
      { userId: aliceId, version: 1, encryptedKey: b64(wrappedAlice), iv: b64(ivAlice) },
      { userId: bobId, version: 1, encryptedKey: b64(wrappedBob), iv: b64(ivBob) },
    ];

    const res = await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({ version: 1, keys })
      .expect(200);

    assert.equal(res.body.data.latestVersion, 1);
  });

  it("4. Rejects non-members from setting keys (HTTP 403)", async () => {
    await resetLimiters(aliceId, outsiderId);
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "E2EE Outsider Test", memberIds: [bobId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", outsider.cookies)
      .send({
        version: 1,
        keys: [{ userId: outsiderId, version: 1, wrappedKey: b64(randomIv()), iv: b64(randomIv()) }],
      })
      .expect(403);
  });

  it("5. Key rotation enforces sequential version", async () => {
    await resetLimiters(aliceId);
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "E2EE Rotation Test", memberIds: [bobId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    const raw1 = crypto.getRandomValues(new Uint8Array(32));
    const sharedAlice = await deriveShared(aliceIdent.pair.privateKey, aliceIdent.pair.publicKey);
    const ivA1 = randomIv();
    const wA1 = await subtle.encrypt({ name: "AES-GCM", iv: ivA1 }, sharedAlice, raw1);
    const bobPub = await subtle.importKey("jwk", bobIdent.publicJwk, ECDH, true, []);
    const sharedBob = await deriveShared(aliceIdent.pair.privateKey, bobPub);
    const ivB1 = randomIv();
    const wB1 = await subtle.encrypt({ name: "AES-GCM", iv: ivB1 }, sharedBob, raw1);

    // Set version 1
    await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({
        version: 1,
        entries: [
          { userId: aliceId, version: 1, wrappedKey: b64(wA1), iv: b64(ivA1) },
          { userId: bobId, version: 1, wrappedKey: b64(wB1), iv: b64(ivB1) },
        ],
      })
      .expect(200);

    // Try to jump to version 3 (should fail sequential check)
    const raw3 = crypto.getRandomValues(new Uint8Array(32));
    const ivA3 = randomIv();
    const wA3 = await subtle.encrypt({ name: "AES-GCM", iv: ivA3 }, sharedAlice, raw3);
    const ivB3 = randomIv();
    const wB3 = await subtle.encrypt({ name: "AES-GCM", iv: ivB3 }, sharedBob, raw3);

    await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({
        version: 3,
        entries: [
          { userId: aliceId, version: 3, wrappedKey: b64(wA3), iv: b64(ivA3) },
          { userId: bobId, version: 3, wrappedKey: b64(wB3), iv: b64(ivB3) },
        ],
      })
      .expect(400);

    // Rotate sequentially to version 2
    const raw2 = crypto.getRandomValues(new Uint8Array(32));
    const ivA2 = randomIv();
    const wA2 = await subtle.encrypt({ name: "AES-GCM", iv: ivA2 }, sharedAlice, raw2);
    const ivB2 = randomIv();
    const wB2 = await subtle.encrypt({ name: "AES-GCM", iv: ivB2 }, sharedBob, raw2);

    const rotRes = await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({
        version: 2,
        entries: [
          { userId: aliceId, version: 2, wrappedKey: b64(wA2), iv: b64(ivA2) },
          { userId: bobId, version: 2, wrappedKey: b64(wB2), iv: b64(ivB2) },
        ],
      })
      .expect(200);

    assert.equal(rotRes.body.data.latestVersion, 2);
  });

  it("6. GET /groups/:id/keys/pending reports pending key members", async () => {
    await resetLimiters(aliceId);
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "E2EE Pending Test", memberIds: [bobId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    // Check before keys are provisioned
    const pendingBefore = await request(app)
      .get(`/api/v1/groups/${groupId}/keys/pending`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(pendingBefore.body.data.latestVersion, 0);
    assert.equal(pendingBefore.body.message, "Group is not encrypted.");

    // Provision version 1 for Alice and Bob
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const sharedAlice = await deriveShared(aliceIdent.pair.privateKey, aliceIdent.pair.publicKey);
    const ivA = randomIv();
    const wA = await subtle.encrypt({ name: "AES-GCM", iv: ivA }, sharedAlice, raw);
    const bobPub = await subtle.importKey("jwk", bobIdent.publicJwk, ECDH, true, []);
    const sharedBob = await deriveShared(aliceIdent.pair.privateKey, bobPub);
    const ivB = randomIv();
    const wB = await subtle.encrypt({ name: "AES-GCM", iv: ivB }, sharedBob, raw);

    await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({
        version: 1,
        entries: [
          { userId: aliceId, version: 1, wrappedKey: b64(wA), iv: b64(ivA) },
          { userId: bobId, version: 1, wrappedKey: b64(wB), iv: b64(ivB) },
        ],
      })
      .expect(200);

    // Add Charlie as a new member
    await request(app)
      .post(`/api/v1/groups/${groupId}/members`)
      .set("Cookie", alice.cookies)
      .send({ memberIds: [charlieId] })
      .expect(200);

    // Charlie has no key yet -> check pending
    const pendingAfter = await request(app)
      .get(`/api/v1/groups/${groupId}/keys/pending`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(pendingAfter.body.data.latestVersion, 1);
    const pendingList = pendingAfter.body.data.pending;
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0].userId, charlieId);
    assert.deepEqual(pendingList[0].missingVersions, [1]);
    assert(pendingList[0].publicKey);

    // Share version 1 key with Charlie
    const charliePub = await subtle.importKey("jwk", charlieIdent.publicJwk, ECDH, true, []);
    const sharedCharlie = await deriveShared(aliceIdent.pair.privateKey, charliePub);
    const ivC = randomIv();
    const wC = await subtle.encrypt({ name: "AES-GCM", iv: ivC }, sharedCharlie, raw);

    await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({
        version: 1,
        entries: [
          { userId: charlieId, version: 1, wrappedKey: b64(wC), iv: b64(ivC) },
        ],
      })
      .expect(200);

    // Pending should now be empty
    const pendingResolved = await request(app)
      .get(`/api/v1/groups/${groupId}/keys/pending`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(pendingResolved.body.data.pending.length, 0);
  });

  it("7. Sends and delivers encrypted group message to group members", async () => {
    await resetLimiters(aliceId, bobId);
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "E2EE Group Chat", memberIds: [bobId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    // Provision key v1
    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const groupAesKey = await subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);

    const sharedAlice = await deriveShared(aliceIdent.pair.privateKey, aliceIdent.pair.publicKey);
    const ivA = randomIv();
    const wA = await subtle.encrypt({ name: "AES-GCM", iv: ivA }, sharedAlice, rawKey);
    const bobPub = await subtle.importKey("jwk", bobIdent.publicJwk, ECDH, true, []);
    const sharedBob = await deriveShared(aliceIdent.pair.privateKey, bobPub);
    const ivB = randomIv();
    const wB = await subtle.encrypt({ name: "AES-GCM", iv: ivB }, sharedBob, rawKey);

    await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({
        version: 1,
        entries: [
          { userId: aliceId, version: 1, wrappedKey: b64(wA), iv: b64(ivA) },
          { userId: bobId, version: 1, wrappedKey: b64(wB), iv: b64(ivB) },
        ],
      })
      .expect(200);

    // Alice encrypts message with group key
    const plaintext = "Hello Secret Group!";
    const msgIv = randomIv();
    const ct = await subtle.encrypt(
      { name: "AES-GCM", iv: msgIv },
      groupAesKey,
      enc.encode(plaintext),
    );

    // Alice sends encrypted message
    const sendRes = await request(app)
      .post(`/api/v1/groups/${groupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", b64(ct))
      .field("iv", b64(msgIv))
      .field("keyVersion", "1")
      .field("encrypted", "true")
      .field("clientId", "e2ee-group-msg-1")
      .expect(201);

    const msgData = sendRes.body.data;
    assert.equal(msgData.encrypted, true);
    assert.equal(msgData.keyVersion, 1);
    assert.equal(msgData.iv, b64(msgIv));
    assert.equal(msgData.text, b64(ct));

    // Bob retrieves messages and decrypts
    const bobMsgsRes = await request(app)
      .get(`/api/v1/groups/${groupId}/messages`)
      .set("Cookie", bob.cookies)
      .expect(200);

    const receivedMsg = bobMsgsRes.body.data.find((m) => m.clientId === "e2ee-group-msg-1");
    assert(receivedMsg);

    // Bob decrypts with the group AES key
    const decryptedPt = await subtle.decrypt(
      { name: "AES-GCM", iv: unb64(receivedMsg.iv) },
      groupAesKey,
      unb64(receivedMsg.text),
    );

    assert.equal(dec.decode(decryptedPt), plaintext);
  });

  it("8. Group key provisioning succeeds even if a member has not registered an E2EE key yet", async () => {
    await resetLimiters(aliceId, bobId);
    // outsider (David) has NO registered E2EE key
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({ name: "Mixed Keys Group", memberIds: [bobId, outsiderId] })
      .expect(201);
    const groupId = groupRes.body.data.id || groupRes.body.data._id;

    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    const sharedAlice = await deriveShared(aliceIdent.pair.privateKey, aliceIdent.pair.publicKey);
    const ivA = randomIv();
    const wA = await subtle.encrypt({ name: "AES-GCM", iv: ivA }, sharedAlice, rawKey);
    const bobPub = await subtle.importKey("jwk", bobIdent.publicJwk, ECDH, true, []);
    const sharedBob = await deriveShared(aliceIdent.pair.privateKey, bobPub);
    const ivB = randomIv();
    const wB = await subtle.encrypt({ name: "AES-GCM", iv: ivB }, sharedBob, rawKey);

    // Alice provisions for Alice & Bob (David is skipped because he has no public key yet)
    const provRes = await request(app)
      .post(`/api/v1/groups/${groupId}/keys`)
      .set("Cookie", alice.cookies)
      .send({
        version: 1,
        entries: [
          { userId: aliceId, version: 1, wrappedKey: b64(wA), iv: b64(ivA) },
          { userId: bobId, version: 1, wrappedKey: b64(wB), iv: b64(ivB) },
        ],
      })
      .expect(200);

    assert.equal(provRes.body.data.latestVersion, 1);
    assert.equal(provRes.body.data.stored, 2);

    // Check pending keys -> David is listed as pending
    const pendingRes = await request(app)
      .get(`/api/v1/groups/${groupId}/keys/pending`)
      .set("Cookie", alice.cookies)
      .expect(200);

    const pendingDavid = pendingRes.body.data.pending.find((p) => p.userId === outsiderId);
    assert(pendingDavid);
    assert.equal(pendingDavid.publicKey, null); // No key yet
  });
});
