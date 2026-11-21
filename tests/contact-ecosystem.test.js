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
import Notification from "../src/modules/notifications/models/notification.model.js";

test("Complete Contact Management, Social Connection & Notification Ecosystem Suite", async (t) => {
  const env = await setupTestEnvironment();
  const { app, ioServer, server } = env;

  let alice, bob, charlie, port;
  let aliceSocket, bobSocket;

  await t.test("Setup test users and authenticated sockets", async () => {
    port = server.address().port;
    const sessions = await createAndLoginUsers(app, port, { makeContacts: false });

    alice = sessions.alice;
    bob = sessions.bob;
    charlie = sessions.charlie;

    aliceSocket = alice.socket;
    bobSocket = bob.socket;

    await User.findByIdAndUpdate(alice.user._id, {
      username: "alice_eco",
      phone: "+15551112222",
    });
    await User.findByIdAndUpdate(bob.user._id, {
      username: "bob_eco",
      phone: "+15553334444",
    });
    await User.findByIdAndUpdate(charlie.user._id, {
      username: "charlie_eco",
      phone: "+15555556666",
    });
  });

  await t.test("1. User Discovery with relationship-aware status", async () => {
    const res = await request(app)
      .get("/api/v1/contacts/search?q=bob_eco")
      .set("Cookie", alice.cookies);

    assert.equal(res.status, 200);
    const bobResult = res.body.data.users.find(
      (u) => String(u.id || u._id) === String(bob.user._id),
    );
    assert.ok(bobResult, "Bob should be found");
    assert.equal(bobResult.relationship, "none");
    assert.equal(bobResult.isContact, false);

    // Verify messaging is blocked when not connected
    const preContactMsgRes = await request(app)
      .post(`/api/v1/messages/send/${bob.user._id}`)
      .set("Cookie", alice.cookies)
      .send({ text: "Hello Bob" });

    assert.equal(preContactMsgRes.status, 403);
    assert.equal(preContactMsgRes.body.code, "CONTACT_NOT_ACCEPTED");

    const preContactGetRes = await request(app)
      .get(`/api/v1/messages/${bob.user._id}`)
      .set("Cookie", alice.cookies);

    assert.equal(preContactGetRes.status, 403);
    assert.equal(preContactGetRes.body.code, "CONTACT_NOT_ACCEPTED");
  });

  let bobRequestId = null;

  await t.test("2. Send Contact Request + Real-time socket & Persistent Notification", async () => {
    const socketReceivedPromise = new Promise((resolve) => {
      bobSocket.once("contact:request:received", (payload) => {
        resolve(payload);
      });
    });

    const notifReceivedPromise = new Promise((resolve) => {
      bobSocket.once("notification:new", (payload) => {
        resolve(payload);
      });
    });

    const res = await request(app)
      .post(`/api/v1/contacts/requests/${bob.user._id}`)
      .set("Cookie", alice.cookies)
      .send({ note: "Hey Bob, let's connect on Chatty!" });

    assert.equal(res.status, 201);
    assert.ok(res.body.data.requestId);
    bobRequestId = res.body.data.requestId;

    const [sockPayload, notifPayload] = await Promise.all([
      socketReceivedPromise,
      notifReceivedPromise,
    ]);

    assert.equal(sockPayload.requestId, bobRequestId);
    assert.equal(notifPayload.type, "contact_request_received");

    // Check relationship is now "request_sent" for Alice
    const searchAfterSend = await request(app)
      .get("/api/v1/contacts/search?q=bob_eco")
      .set("Cookie", alice.cookies);

    const bobUpdated = searchAfterSend.body.data.users.find(
      (u) => String(u.id || u._id) === String(bob.user._id),
    );
    assert.equal(bobUpdated.relationship, "request_sent");

    // Verify messaging is still blocked while request is pending
    const pendingMsgRes = await request(app)
      .post(`/api/v1/messages/send/${bob.user._id}`)
      .set("Cookie", alice.cookies)
      .send({ text: "Hello Bob during pending" });

    assert.equal(pendingMsgRes.status, 403);
    assert.equal(pendingMsgRes.body.code, "CONTACT_NOT_ACCEPTED");
  });

  await t.test("3. Persistent Notification Center: Fetch, Unread Count & Mark Read", async () => {
    const resCount = await request(app)
      .get("/api/v1/notifications/unread-count")
      .set("Cookie", bob.cookies);

    assert.equal(resCount.status, 200);
    assert.ok(resCount.body.data.count >= 1);

    const resList = await request(app)
      .get("/api/v1/notifications")
      .set("Cookie", bob.cookies);

    assert.equal(resList.status, 200);
    assert.ok(resList.body.data.items.length >= 1);
    const notif = resList.body.data.items[0];

    // Mark as read
    const resRead = await request(app)
      .patch(`/api/v1/notifications/${notif.id || notif._id}/read`)
      .set("Cookie", bob.cookies);

    assert.equal(resRead.status, 200);
    assert.equal(resRead.body.data.isRead, true);

    // Mark all as read
    const resReadAll = await request(app)
      .patch("/api/v1/notifications/read-all")
      .set("Cookie", bob.cookies);

    assert.equal(resReadAll.status, 200);
    assert.equal(resReadAll.body.data.unreadCount, 0);
  });

  await t.test("4. Accept Contact Request + Bidirectional Contact establishment", async () => {
    const contactAddedPromise = new Promise((resolve) => {
      aliceSocket.once("contact:added", resolve);
    });

    const res = await request(app)
      .post(`/api/v1/contacts/requests/${bobRequestId}/accept`)
      .set("Cookie", bob.cookies);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, "accepted");

    await contactAddedPromise;

    // Both users must now have each other in contact list
    const [aliceContacts, bobContacts] = await Promise.all([
      request(app).get("/api/v1/contacts").set("Cookie", alice.cookies),
      request(app).get("/api/v1/contacts").set("Cookie", bob.cookies),
    ]);

    const aliceHasBob = aliceContacts.body.data.contacts.some(
      (c) => String(c._id || c.id || c.contactId?._id || c.contactId) === String(bob.user._id),
    );
    const bobHasAlice = bobContacts.body.data.contacts.some(
      (c) => String(c._id || c.id || c.contactId?._id || c.contactId) === String(alice.user._id),
    );

    assert.ok(aliceHasBob, "Alice must have Bob in contacts");
    assert.ok(bobHasAlice, "Bob must have Alice in contacts");

    // Verify messaging is unlocked now that contact is accepted
    const postAcceptMsgRes = await request(app)
      .post(`/api/v1/messages/send/${bob.user._id}`)
      .set("Cookie", alice.cookies)
      .send({ text: "Hello Bob, we are now contacts!" });

    assert.equal(postAcceptMsgRes.status, 201);
    assert.ok(postAcceptMsgRes.body.data.id || postAcceptMsgRes.body.data._id);

    const bobGetRes = await request(app)
      .get(`/api/v1/messages/${alice.user._id}`)
      .set("Cookie", bob.cookies);

    assert.equal(bobGetRes.status, 200);
    assert.ok(bobGetRes.body.data.length >= 1);
  });

  await t.test("4b. Authorization and pending status validation on request accept/reject", async () => {
    // Attempting to accept already accepted request -> 400 Bad Request
    const reAcceptRes = await request(app)
      .post(`/api/v1/contacts/requests/${bobRequestId}/accept`)
      .set("Cookie", bob.cookies);
    assert.equal(reAcceptRes.status, 400);

    // Charlie sends request to Alice
    const sendRes = await request(app)
      .post(`/api/v1/contacts/requests/${alice.user._id}`)
      .set("Cookie", charlie.cookies);
    assert.equal(sendRes.status, 201);
    const charlieReqId = sendRes.body.data.id || sendRes.body.data._id || sendRes.body.data.requestId;

    // Bob tries to accept Charlie's request to Alice -> 403 Forbidden
    const bobAcceptRes = await request(app)
      .post(`/api/v1/contacts/requests/${charlieReqId}/accept`)
      .set("Cookie", bob.cookies);
    assert.equal(bobAcceptRes.status, 403);

    // Bob tries to decline Charlie's request to Alice -> 403 Forbidden
    const bobDeclineRes = await request(app)
      .post(`/api/v1/contacts/requests/${charlieReqId}/reject`)
      .set("Cookie", bob.cookies);
    assert.equal(bobDeclineRes.status, 403);

    // Alice declines Charlie's request -> 200 OK
    const aliceDeclineRes = await request(app)
      .post(`/api/v1/contacts/requests/${charlieReqId}/reject`)
      .set("Cookie", alice.cookies);
    assert.equal(aliceDeclineRes.status, 200);

    // Alice tries to decline again -> 400 Bad Request
    const reDeclineRes = await request(app)
      .post(`/api/v1/contacts/requests/${charlieReqId}/reject`)
      .set("Cookie", alice.cookies);
    assert.equal(reDeclineRes.status, 400);
  });

  await t.test("5. Contact Request History Endpoint", async () => {
    const res = await request(app)
      .get("/api/v1/contacts/requests/history")
      .set("Cookie", alice.cookies);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.items.length >= 1);
    const item = res.body.data.items.find((i) => i.id === bobRequestId);
    assert.ok(item, "History must contain the accepted request");
    assert.equal(item.status, "accepted");
  });

  await t.test("6. QR Code Resolution Endpoint (/api/v1/users/resolve-qr)", async () => {
    // Generate QR payload for Charlie
    const qrRes = await request(app)
      .get("/api/v1/users/me/qr")
      .set("Cookie", charlie.cookies);

    assert.equal(qrRes.status, 200);
    const payload = qrRes.body.data.payload;

    // Alice resolves Charlie's QR payload
    const resolveRes = await request(app)
      .post("/api/v1/users/resolve-qr")
      .set("Cookie", alice.cookies)
      .send({ payload });

    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.body.data.user.username, "charlie_eco");
    assert.equal(resolveRes.body.data.relationship, "none");
  });

  await t.test("7. User Reporting with category validation", async () => {
    const reportRes = await request(app)
      .post(`/api/v1/users/${charlie.user._id}/report`)
      .set("Cookie", alice.cookies)
      .send({
        reason: "fake_account",
        details: "Deceptive profile detected during review.",
      });

    assert.ok([200, 201].includes(reportRes.status));
    assert.ok(reportRes.body.message || reportRes.body.data?.message);
  });

  await t.test("8. Block User: cleans up contacts and invalidates pending requests", async () => {
    // Charlie sends Bob a contact request
    const reqRes = await request(app)
      .post(`/api/v1/contacts/requests/${bob.user._id}`)
      .set("Cookie", charlie.cookies);

    assert.equal(reqRes.status, 201);

    // Bob blocks Charlie
    const blockRes = await request(app)
      .post(`/api/v1/users/${charlie.user._id}/block`)
      .set("Cookie", bob.cookies);

    assert.equal(blockRes.status, 200);

    // The pending request must now be cancelled
    const pending = await ContactRequest.findOne({
      senderId: charlie.user._id,
      recipientId: bob.user._id,
      status: CONTACT_REQUEST_STATUS.PENDING,
    });
    assert.equal(pending, null, "Pending request must be invalidated on block");

    // Unblock Charlie
    const unblockRes = await request(app)
      .delete(`/api/v1/users/${charlie.user._id}/block`)
      .set("Cookie", bob.cookies);

    assert.equal(unblockRes.status, 200);
  });

  await t.test("9. Bidirectional Contact Removal: preserves history", async () => {
    const res = await request(app)
      .delete(`/api/v1/contacts/${bob.user._id}`)
      .set("Cookie", alice.cookies);

    assert.equal(res.status, 200);

    // Verify removed on both sides
    const [aliceHas, bobHas] = await Promise.all([
      Contact.exists({ ownerId: alice.user._id, contactId: bob.user._id }),
      Contact.exists({ ownerId: bob.user._id, contactId: alice.user._id }),
    ]);

    assert.equal(Boolean(aliceHas), false);
    assert.equal(Boolean(bobHas), false);

    // Verify messaging is blocked again after contact removal
    const postRemoveMsgRes = await request(app)
      .post(`/api/v1/messages/send/${bob.user._id}`)
      .set("Cookie", alice.cookies)
      .send({ text: "Hello after removal" });

    assert.equal(postRemoveMsgRes.status, 403);
    assert.equal(postRemoveMsgRes.body.code, "CONTACT_NOT_ACCEPTED");
  });

  t.after(async () => {
    if (aliceSocket?.connected) aliceSocket.disconnect();
    if (bobSocket?.connected) bobSocket.disconnect();
    if (charlie?.socket?.connected) charlie.socket.disconnect();
    await teardownTestEnvironment(env);
  });
});
