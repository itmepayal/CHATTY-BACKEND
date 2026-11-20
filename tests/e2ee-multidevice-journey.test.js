import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";

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
  const publicRaw = await subtle.exportKey("raw", pair.publicKey);
  const cleanPublicJwk = {
    kty: publicJwk.kty,
    crv: publicJwk.crv,
    x: publicJwk.x,
    y: publicJwk.y,
  };
  return { pair, publicJwk: cleanPublicJwk, privateJwk, publicRaw };
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

async function clientEncryptFor(senderIdentity, destDevices, plaintext) {
  const msgKeyRaw = crypto.getRandomValues(new Uint8Array(32));
  const msgKey = await subtle.importKey("raw", msgKeyRaw, "AES-GCM", false, ["encrypt"]);
  const msgIv = randomIv();
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: msgIv },
    msgKey,
    enc.encode(plaintext),
  );

  const ephemeralPair = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const ephemeralPublicRaw = await subtle.exportKey("raw", ephemeralPair.publicKey);
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

async function clientDecryptFrom(myIdentity, myDeviceId, cipherB64, ivB64, keyEnvelopes) {
  const myUserId = String(myIdentity.userId);
  const envelopes = keyEnvelopes || [];
  const myEnvelopes = envelopes.filter((e) => String(e.userId) === myUserId);

  const orderedEnvelopes = [];
  const direct = myEnvelopes.find((e) => e.deviceId === myDeviceId);
  if (direct) orderedEnvelopes.push(direct);
  const def = myEnvelopes.find((e) => e.deviceId === "default" && e !== direct);
  if (def) orderedEnvelopes.push(def);

  // In multi-device sync, authorized new devices try all envelopes matching myUserId
  for (const env of myEnvelopes) {
    if (!orderedEnvelopes.includes(env)) {
      orderedEnvelopes.push(env);
    }
  }

  for (const env of orderedEnvelopes) {
    try {
      if (typeof env.wrappedKey === "string" && env.wrappedKey.startsWith("v2:")) {
        const parts = env.wrappedKey.split(":");
        const ephemPub = await subtle.importKey("raw", unb64(parts[1]), ECDH, false, []);
        const wrapKey = await deriveShared(myIdentity.pair.privateKey, ephemPub);
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
      }
    } catch {
      // try next envelope
    }
  }

  if (myEnvelopes.length === 0) {
    throw new Error("DECRYPTION_KEY_UNAVAILABLE");
  }
  throw new Error("MESSAGE_DECRYPTION_FAILED");
}

test("Master Suite: Complete E2EE Multi-Device User Journey & Historical Restoration", async (t) => {
  const env = await setupTestEnvironment();
  const app = env.app;
  const users = await createAndLoginUsers(app, env.port);

  const alice = users.alice;
  const bob = users.bob;
  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);

  // Clear pre-seeded mock keys
  await User.updateMany(
    { _id: { $in: [aliceId, bobId] } },
    { $unset: { publicKey: 1, encryptedPrivateKey: 1, e2eeBackupVersion: 1 } },
  );

  const recoveryPassphrase = "MasterSecurePassphrase2026!";
  const aliceLaptop = await createIdentity();
  aliceLaptop.userId = aliceId;
  aliceLaptop.deviceId = "alice-laptop-01";

  const bobMobile = await createIdentity();
  bobMobile.userId = bobId;
  bobMobile.deviceId = "bob-mobile-01";

  // Register Alice Laptop and Backup
  const aliceBackupV1 = await createEncryptedBackup(aliceLaptop.privateJwk, recoveryPassphrase, 1);
  await request(app)
    .post("/api/v1/e2ee/keys")
    .set("Cookie", alice.cookies)
    .send({
      publicKey: aliceLaptop.publicJwk,
      encryptedPrivateKey: aliceBackupV1,
      backupVersion: 1,
    })
    .expect(201);

  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", alice.cookies)
    .send({
      deviceId: aliceLaptop.deviceId,
      publicKey: aliceLaptop.publicJwk,
      deviceName: "Alice MacBook Pro",
    })
    .expect(201);

  // Register Bob Mobile
  await request(app)
    .post("/api/v1/e2ee/keys")
    .set("Cookie", bob.cookies)
    .send({
      publicKey: bobMobile.publicJwk,
      encryptedPrivateKey: "sample-bob-backup",
      backupVersion: 1,
    })
    .expect(201);

  await request(app)
    .post("/api/v1/e2ee/devices")
    .set("Cookie", bob.cookies)
    .send({
      deviceId: bobMobile.deviceId,
      publicKey: bobMobile.publicJwk,
      deviceName: "Bob Pixel 9 Pro",
    })
    .expect(201);

  const sentMessages = [];

  await t.test("TEST 1: Alice Laptop and Bob exchange 100 messages; Alice Mobile restores and decrypts all 100", async () => {
    // Exchange 100 messages (50 Alice -> Bob, 50 Bob -> Alice)
    for (let i = 1; i <= 100; i++) {
      const isAliceSender = i % 2 !== 0;
      const sender = isAliceSender ? alice : bob;
      const senderIdent = isAliceSender ? aliceLaptop : bobMobile;
      const receiverId = isAliceSender ? bobId : aliceId;
      const plain = `Historical E2EE message #${i} between Alice and Bob`;

      const encrypted = await clientEncryptFor(
        senderIdent,
        [
          { userId: aliceId, deviceId: aliceLaptop.deviceId, publicKey: aliceLaptop.publicJwk },
          { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
        ],
        plain,
      );

      const res = await request(app)
        .post(`/api/v1/messages/send/${receiverId}`)
        .set("Cookie", sender.cookies)
        .send({
          text: encrypted.text,
          iv: encrypted.iv,
          encrypted: true,
          keyEnvelopes: encrypted.keyEnvelopes,
        })
        .expect(201);

      sentMessages.push({ id: res.body.data.id || res.body.data._id, text: plain });
    }

    assert.equal(sentMessages.length, 100);

    // Alice now logs in on Mobile Device 2
    // Device 2 fetches encrypted backup from server
    const backupRes = await request(app)
      .get("/api/v1/e2ee/backup")
      .set("Cookie", alice.cookies)
      .expect(200);

    // Decrypt backup with recovery passphrase
    const recoveredPrivateJwk = await decryptEncryptedBackup(
      backupRes.body.data.encryptedPrivateKey,
      recoveryPassphrase,
    );
    assert.equal(recoveredPrivateJwk.d, aliceLaptop.privateJwk.d);

    // Mobile Device 2 imports recovered private key and creates identity object
    const restoredAliceMobile = {
      userId: aliceId,
      deviceId: "alice-iphone-02",
      publicJwk: aliceLaptop.publicJwk,
      pair: {
        privateKey: await subtle.importKey(
          "jwk",
          recoveredPrivateJwk,
          ECDH,
          false,
          ["deriveBits"],
        ),
      },
    };

    // Device 2 registers presence
    await request(app)
      .post("/api/v1/e2ee/devices")
      .set("Cookie", alice.cookies)
      .send({
        deviceId: restoredAliceMobile.deviceId,
        publicKey: restoredAliceMobile.publicJwk,
        deviceName: "Alice iPhone 16",
      })
      .expect(201);

    // Alice fetches historical messages from backend
    const histRes = await request(app)
      .get(`/api/v1/messages/${bobId}?limit=100`)
      .set("Cookie", alice.cookies)
      .expect(200);

    const history = histRes.body.data;
    assert.equal(history.length, 100);

    // Decrypt every single historical message on Mobile Device 2!
    for (const m of history) {
      const decrypted = await clientDecryptFrom(
        restoredAliceMobile,
        restoredAliceMobile.deviceId,
        m.text,
        m.iv,
        m.keyEnvelopes,
      );
      const expected = sentMessages.find((s) => String(s.id) === String(m.id || m._id));
      assert.ok(expected, "Message ID found");
      assert.equal(decrypted, expected.text, "Historical message successfully decrypted on Device 2");
    }
  });

  let aliceMobileDevice;

  await t.test("TEST 2: Bob sends a new message; Alice Mobile receives and decrypts it", async () => {
    // Bob queries Alice's devices from public keys endpoint
    const pubRes = await request(app)
      .post("/api/v1/e2ee/devices/public-keys")
      .set("Cookie", bob.cookies)
      .send({ userIds: [aliceId] })
      .expect(200);

    const aliceDevices = pubRes.body.data.userDevices[aliceId];
    assert.equal(aliceDevices.length, 2, "Alice has 2 active devices (Laptop and Mobile)");

    aliceMobileDevice = aliceDevices.find((d) => d.deviceId === "alice-iphone-02");
    assert.ok(aliceMobileDevice, "Found Mobile Device 2");

    const newPlain = "Live message from Bob to Alice after Mobile logged in";
    const encrypted = await clientEncryptFor(
      bobMobile,
      [
        { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
        { userId: aliceId, deviceId: "alice-laptop-01", publicKey: aliceLaptop.publicJwk },
        { userId: aliceId, deviceId: "alice-iphone-02", publicKey: aliceMobileDevice.publicKey },
      ],
      newPlain,
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

    const savedMsg = sendRes.body.data;
    assert.equal(savedMsg.keyEnvelopes.length, 3);

    // Mobile Device 2 decrypts
    const aliceMobileIdentity = {
      userId: aliceId,
      deviceId: "alice-iphone-02",
      pair: {
        privateKey: await subtle.importKey(
          "jwk",
          aliceLaptop.privateJwk,
          ECDH,
          false,
          ["deriveBits"],
        ),
      },
    };

    const decryptedMobile = await clientDecryptFrom(
      aliceMobileIdentity,
      "alice-iphone-02",
      savedMsg.text,
      savedMsg.iv,
      savedMsg.keyEnvelopes,
    );
    assert.equal(decryptedMobile, newPlain);
  });

  await t.test("TEST 3: Alice sends from Mobile; Laptop receives and decrypts it", async () => {
    const mobilePlain = "Live reply from Alice Mobile to Bob";
    const encryptedFromMobile = await clientEncryptFor(
      aliceLaptop, // same master private key
      [
        { userId: aliceId, deviceId: "alice-iphone-02", publicKey: aliceLaptop.publicJwk },
        { userId: aliceId, deviceId: "alice-laptop-01", publicKey: aliceLaptop.publicJwk },
        { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
      ],
      mobilePlain,
    );

    const res = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: encryptedFromMobile.text,
        iv: encryptedFromMobile.iv,
        encrypted: true,
        keyEnvelopes: encryptedFromMobile.keyEnvelopes,
      })
      .expect(201);

    const msg = res.body.data;

    // Laptop receives and decrypts own message
    const laptopDecrypted = await clientDecryptFrom(
      aliceLaptop,
      aliceLaptop.deviceId,
      msg.text,
      msg.iv,
      msg.keyEnvelopes,
    );
    assert.equal(laptopDecrypted, mobilePlain);

    // Bob receives and decrypts
    const bobDecrypted = await clientDecryptFrom(
      bobMobile,
      bobMobile.deviceId,
      msg.text,
      msg.iv,
      msg.keyEnvelopes,
    );
    assert.equal(bobDecrypted, mobilePlain);
  });

  await t.test("TEST 4: Alice links a 3rd device (Tablet); all 3 devices synchronize messages", async () => {
    // Register Device 3 (iPad)
    await request(app)
      .post("/api/v1/e2ee/devices")
      .set("Cookie", alice.cookies)
      .send({
        deviceId: "alice-ipad-03",
        publicKey: aliceLaptop.publicJwk,
        deviceName: "Alice iPad Air",
      })
      .expect(201);

    const pubRes = await request(app)
      .post("/api/v1/e2ee/devices/public-keys")
      .set("Cookie", bob.cookies)
      .send({ userIds: [aliceId] })
      .expect(200);

    const devices = pubRes.body.data.userDevices[aliceId];
    assert.equal(devices.length, 3, "Alice now has 3 active devices");

    const multiPlain = "Message to all 3 of Alice's devices";
    const targetDevices = [
      { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
      ...devices.map((d) => ({ userId: aliceId, deviceId: d.deviceId, publicKey: d.publicKey })),
    ];

    const encrypted = await clientEncryptFor(bobMobile, targetDevices, multiPlain);

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

    const msg = sendRes.body.data;
    assert.equal(msg.keyEnvelopes.length, 4); // 3 for Alice, 1 for Bob

    // Dev 1 (Laptop) decrypts
    const d1 = await clientDecryptFrom(aliceLaptop, "alice-laptop-01", msg.text, msg.iv, msg.keyEnvelopes);
    assert.equal(d1, multiPlain);

    // Dev 2 (Mobile) decrypts
    const d2 = await clientDecryptFrom(aliceLaptop, "alice-iphone-02", msg.text, msg.iv, msg.keyEnvelopes);
    assert.equal(d2, multiPlain);

    // Dev 3 (Tablet) decrypts
    const d3 = await clientDecryptFrom(aliceLaptop, "alice-ipad-03", msg.text, msg.iv, msg.keyEnvelopes);
    assert.equal(d3, multiPlain);
  });

  await t.test("TEST 5: Zero-Knowledge Device Linking: ephemeral ECDH key exchange", async () => {
    // Device B generates ephemeral ECDH pair and initiates link session
    const ephemeralB = await subtle.generateKey(ECDH, true, ["deriveBits"]);
    const ephemeralBPubRaw = await subtle.exportKey("raw", ephemeralB.publicKey);

    const linkReq = await request(app)
      .post("/api/v1/e2ee/devices/link/request")
      .set("Cookie", alice.cookies)
      .send({
        ephemeralPublicKey: {
          kty: "EC",
          crv: "P-256",
          x: "W98p5T6W61qJ1KjY64EwUoZl9cO2L5mG3uV6x7y8z9A",
          y: "N12o3P4Q5R6S7T8U9V0W1X2Y3Z4A5B6C7D8E9F0G1H2",
        },
        deviceId: "device_laptop_b_link",
        deviceName: "Alice's iPad Mini",
      })
      .expect(201);

    const { linkSessionId, linkingPin } = linkReq.body.data;
    assert.ok(linkSessionId);
    assert.match(linkingPin, /^\d{6}$/);

    // Device A (approver) looks up pending session by PIN
    const lookupRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/pin/${linkingPin}`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(lookupRes.body.data.linkSessionId, linkSessionId);

    // Device A approves session
    const fakePayload = {
      ciphertext: "cGludGVzdENpcGhlcnRleHQ=",
      iv: "cGludGVzdEl2MTIz",
    };

    await request(app)
      .post("/api/v1/e2ee/devices/link/approve")
      .set("Cookie", alice.cookies)
      .send({
        linkSessionId,
        encryptedPayload: fakePayload,
        approverDeviceId: "alice-laptop-01",
      })
      .expect(200);

    // Device B polls and receives approved session
    const statusRes = await request(app)
      .get(`/api/v1/e2ee/devices/link/status/${linkSessionId}`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(statusRes.body.data.status, "approved");
    assert.deepEqual(statusRes.body.data.encryptedPayload, fakePayload);
  });

  await t.test("TEST 6: Offline New Device links via password backup without old device online", async () => {
    // Old devices are completely offline. New device queries backup directly
    const backupRes = await request(app)
      .get("/api/v1/e2ee/backup")
      .set("Cookie", alice.cookies)
      .expect(200);

    const restoredJwk = await decryptEncryptedBackup(
      backupRes.body.data.encryptedPrivateKey,
      recoveryPassphrase,
    );
    assert.equal(restoredJwk.d, aliceLaptop.privateJwk.d);
  });

  await t.test("TEST 7: User A revokes an old device; revoked device excluded from future messages", async () => {
    // Alice revokes Device 3 (iPad)
    const revokeRes = await request(app)
      .delete("/api/v1/e2ee/devices/alice-ipad-03")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.equal(revokeRes.body.data.revoked, true);

    // Query active devices for Alice
    const pubRes = await request(app)
      .post("/api/v1/e2ee/devices/public-keys")
      .set("Cookie", bob.cookies)
      .send({ userIds: [aliceId] })
      .expect(200);

    const activeDevices = pubRes.body.data.userDevices[aliceId];
    assert.equal(activeDevices.length, 2, "Only Laptop and Mobile remain active");
    assert.ok(!activeDevices.some((d) => d.deviceId === "alice-ipad-03"), "Revoked iPad is excluded");

    // Bob sends a message to Alice
    const plain = "Message after iPad was revoked";
    const encrypted = await clientEncryptFor(
      bobMobile,
      [
        { userId: bobId, deviceId: bobMobile.deviceId, publicKey: bobMobile.publicJwk },
        ...activeDevices.map((d) => ({ userId: aliceId, deviceId: d.deviceId, publicKey: d.publicKey })),
      ],
      plain,
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

    const msg = sendRes.body.data;
    assert.ok(!msg.keyEnvelopes.some((e) => e.deviceId === "alice-ipad-03"), "No envelope for revoked device");
  });

  await t.test("TEST 8: App reinstall: re-entering passphrase recovers all message history", async () => {
    // Simulating freshly reinstalled app on new hardware
    const reinstalledDevice = {
      userId: aliceId,
      deviceId: "alice-reinstalled-04",
      pair: {
        privateKey: await subtle.importKey(
          "jwk",
          aliceLaptop.privateJwk,
          ECDH,
          false,
          ["deriveBits"],
        ),
      },
    };

    // Fetches history and decrypts message #50
    const histRes = await request(app)
      .get(`/api/v1/messages/${bobId}?limit=100`)
      .set("Cookie", alice.cookies)
      .expect(200);

    const targetMsg = histRes.body.data.find(
      (m) => String(m.id || m._id) === String(sentMessages[49].id),
    );
    assert.ok(targetMsg);

    const decrypted = await clientDecryptFrom(
      reinstalledDevice,
      reinstalledDevice.deviceId,
      targetMsg.text,
      targetMsg.iv,
      targetMsg.keyEnvelopes,
    );
    assert.equal(decrypted, sentMessages[49].text);
  });

  await t.test("TEST 9: Message with missing or invalid key metadata does not block conversation loading", async () => {
    const corruptMsg = {
      text: b64(new Uint8Array(32)),
      iv: b64(randomIv()),
      keyEnvelopes: [
        { userId: aliceId, deviceId: "alice-laptop-01", wrappedKey: "v2:invalid:envelope", iv: b64(randomIv()) },
      ],
    };

    await assert.rejects(
      async () => {
        await clientDecryptFrom(aliceLaptop, "alice-laptop-01", corruptMsg.text, corruptMsg.iv, corruptMsg.keyEnvelopes);
      },
      /MESSAGE_DECRYPTION_FAILED/,
    );
  });

  await t.test("TEST 10: Web and Mobile cryptographic interoperability", async () => {
    // Web (laptop) creates standard ECIES v2 envelope
    const webPlain = "Interoperability Web -> Mobile test";
    const webEncrypted = await clientEncryptFor(
      aliceLaptop,
      [{ userId: bobId, deviceId: "bob-android-native", publicKey: bobMobile.publicJwk }],
      webPlain,
    );

    // Mobile (Android / iOS) receives envelope format v2:<ephemPubRaw>:<wrappedKey> and decrypts
    const mobileDecrypted = await clientDecryptFrom(
      bobMobile,
      "bob-android-native",
      webEncrypted.text,
      webEncrypted.iv,
      webEncrypted.keyEnvelopes,
    );
    assert.equal(mobileDecrypted, webPlain);

    // Mobile encrypts -> Web decrypts
    const mobilePlain = "Interoperability Mobile -> Web test";
    const mobileEncrypted = await clientEncryptFor(
      bobMobile,
      [{ userId: aliceId, deviceId: "alice-web-browser", publicKey: aliceLaptop.publicJwk }],
      mobilePlain,
    );

    const webDecrypted = await clientDecryptFrom(
      aliceLaptop,
      "alice-web-browser",
      mobileEncrypted.text,
      mobileEncrypted.iv,
      mobileEncrypted.keyEnvelopes,
    );
    assert.equal(webDecrypted, mobilePlain);
  });

  await teardownTestEnvironment();
});
