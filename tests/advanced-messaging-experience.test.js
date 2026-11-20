import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import Contact from "../src/modules/contacts/models/contact.model.js";
import ContactRequest, {
  CONTACT_REQUEST_STATUS,
} from "../src/modules/contacts/models/contact-request.model.js";
import Message from "../src/modules/messaging/models/message.model.js";

test("Advanced Professional Messaging Suite: Contact Discovery, Requests, Stars, Pins, QR", async (t) => {
  const { app, ioServer, server } = await setupTestEnvironment();

  let alice, bob, charlie;

  await t.test("Setup test users with phone and profiles", async () => {
    const port = server.address().port;
    const sessions = await createAndLoginUsers(app, port);

    alice = sessions.alice;
    bob = sessions.bob;
    charlie = sessions.charlie;

    // Set phone numbers & usernames
    await User.findByIdAndUpdate(alice.user._id, {
      username: "alice_vance",
      phone: "+15551234567",
    });
    await User.findByIdAndUpdate(bob.user._id, {
      username: "bob_builder",
      phone: "+15559876543",
    });
    await User.findByIdAndUpdate(charlie.user._id, {
      username: "charlie_b",
      phone: "+15550001122",
    });
  });

  await t.test("1. Advanced Contact Discovery by Phone, Username and Email", async () => {
    // Search by partial phone
    const resPhone = await request(app)
      .get("/api/v1/contacts/search?q=9876543")
      .set("Cookie", alice.cookies);

    assert.equal(resPhone.status, 200);
    const foundBobPhone = resPhone.body.data.users.find(
      (u) => String(u.id || u._id) === String(bob.user._id),
    );
    assert.ok(foundBobPhone, "Should find Bob using phone number search");

    // Search by username
    const resUsername = await request(app)
      .get("/api/v1/contacts/search?q=charlie_b")
      .set("Cookie", alice.cookies);

    assert.equal(resUsername.status, 200);
    const foundCharlie = resUsername.body.data.users.find(
      (u) => String(u.id || u._id) === String(charlie.user._id),
    );
    assert.ok(foundCharlie, "Should find Charlie using username");

    // Search by email
    const resEmail = await request(app)
      .get("/api/v1/contacts/search?q=bob@test.com")
      .set("Cookie", alice.cookies);

    assert.equal(resEmail.status, 200);
    const foundBobEmail = resEmail.body.data.users.find(
      (u) => String(u.id || u._id) === String(bob.user._id),
    );
    assert.ok(foundBobEmail, "Should find Bob using email");
  });

  await t.test("2. QR Code Profile Sharing", async () => {
    const resQR = await request(app)
      .get("/api/v1/users/me/qr")
      .set("Cookie", alice.cookies);

    assert.equal(resQR.status, 200);
    assert.ok(resQR.body.data.qrCode, "Should generate QR data URL");
    assert.ok(resQR.body.data.qrCode.startsWith("data:image/png;base64,"));
  });

  let requestId;

  await t.test("3. Contact Requests: Send, List, Accept & Prevent Duplicate", async () => {
    const bobId = String(bob.user._id);
    const aliceId = String(alice.user._id);

    // Alice sends contact request to Bob
    const resSend = await request(app)
      .post(`/api/v1/contacts/requests/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({ note: "Hey Bob, let's connect!" });

    assert.equal(resSend.status, 201);
    requestId = resSend.body.data.requestId;
    assert.ok(requestId, "RequestId must be returned");

    // Duplicate request prevention
    const resDup = await request(app)
      .post(`/api/v1/contacts/requests/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({ note: "Sending again" });

    assert.equal(resDup.status, 409, "Should reject duplicate pending request with 409 Conflict");

    // Bob views incoming requests
    const resBobReqs = await request(app)
      .get("/api/v1/contacts/requests")
      .set("Cookie", bob.cookies);

    assert.equal(resBobReqs.status, 200);
    const inc = resBobReqs.body.data.incoming;
    assert.ok(inc.some((r) => r.id === requestId));

    // Alice views outgoing requests
    const resAliceReqs = await request(app)
      .get("/api/v1/contacts/requests")
      .set("Cookie", alice.cookies);

    assert.equal(resAliceReqs.status, 200);
    const out = resAliceReqs.body.data.outgoing;
    assert.ok(out.some((r) => r.id === requestId));

    // Bob accepts Alice's request
    const resAccept = await request(app)
      .post(`/api/v1/contacts/requests/${requestId}/accept`)
      .set("Cookie", bob.cookies);

    assert.equal(resAccept.status, 200);

    // Verify both are now mutual contacts
    const [aliceHasBob, bobHasAlice] = await Promise.all([
      Contact.exists({ ownerId: aliceId, contactId: bobId }),
      Contact.exists({ ownerId: bobId, contactId: aliceId }),
    ]);
    assert.ok(aliceHasBob && bobHasAlice, "Both Alice and Bob must be mutual contacts now");
  });

  await t.test("4. Mutual Contacts Discovery", async () => {
    const charlieId = String(charlie.user._id);
    const bobId = String(bob.user._id);

    // Alice adds Charlie
    await Contact.create({ ownerId: alice.user._id, contactId: charlieId });
    // Bob adds Charlie
    await Contact.create({ ownerId: bob.user._id, contactId: charlieId });

    // Mutual contacts between Alice and Bob should now include Charlie
    const resMutual = await request(app)
      .get(`/api/v1/contacts/mutual/${bobId}`)
      .set("Cookie", alice.cookies);

    assert.equal(resMutual.status, 200);
    const mutuals = resMutual.body.data.mutualContacts;
    assert.ok(
      mutuals.some((u) => String(u._id || u.id) === charlieId),
      "Charlie must appear in mutual contacts between Alice and Bob",
    );
  });

  let messageId;

  await t.test("5. Starred Messages: Toggle star and fetch starred", async () => {
    const bobId = String(bob.user._id);

    // Alice sends a message to Bob
    const resMsg = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({ text: "Important meeting tomorrow at 10 AM" });

    assert.equal(resMsg.status, 201);
    messageId = resMsg.body.data.id || resMsg.body.data._id;
    assert.ok(messageId);

    // Alice stars the message
    const resStar = await request(app)
      .patch(`/api/v1/users/star-message/${messageId}`)
      .set("Cookie", alice.cookies);

    assert.equal(resStar.status, 200);
    assert.equal(resStar.body.data.isStarred, true);

    // Alice fetches starred messages
    const resStarred = await request(app)
      .get("/api/v1/users/starred-messages")
      .set("Cookie", alice.cookies);

    assert.equal(resStarred.status, 200);
    const starredList = resStarred.body.data;
    assert.ok(starredList.some((m) => m.id === String(messageId)));

    // Unstar
    const resUnstar = await request(app)
      .patch(`/api/v1/users/star-message/${messageId}`)
      .set("Cookie", alice.cookies);

    assert.equal(resUnstar.status, 200);
    assert.equal(resUnstar.body.data.isStarred, false);
  });

  await t.test("6. Pinned & Muted Chats", async () => {
    const bobId = String(bob.user._id);

    // Alice pins Bob's chat
    const resPin = await request(app)
      .patch(`/api/v1/users/${bobId}/pin-chat`)
      .set("Cookie", alice.cookies)
      .send({ pinned: true });

    assert.equal(resPin.status, 200);
    assert.equal(resPin.body.data.pinned, true);

    // Alice mutes Bob's chat
    const resMute = await request(app)
      .patch(`/api/v1/users/${bobId}/mute-chat`)
      .set("Cookie", alice.cookies)
      .send({ muted: true });

    assert.equal(resMute.status, 200);
    assert.equal(resMute.body.data.muted, true);

    // Verify in Alice's user profile
    const aliceUser = await User.findById(alice.user._id);
    assert.ok(aliceUser.pinnedChats.some((id) => String(id) === bobId));
    assert.ok(aliceUser.mutedChats.some((id) => String(id) === bobId));
  });

  // Disconnect sockets
  alice.socket?.disconnect();
  bob.socket?.disconnect();
  charlie.socket?.disconnect();

  await teardownTestEnvironment({ app, ioServer, server });
});
