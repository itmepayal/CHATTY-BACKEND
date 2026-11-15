import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import Group from "../src/modules/groups/models/group.model.js";
import GroupMessage from "../src/modules/groups/models/group-message.model.js";
import Message from "../src/modules/messaging/models/message.model.js";
import { io as ioClient } from "socket.io-client";

async function runActivityReadReceiptsTests() {
  console.log("==================================================");
  console.log("STARTING ACTIVITY & READ RECEIPTS VERIFICATION");
  console.log("==================================================");

  const env = await setupTestEnvironment();
  let passed = 0;
  let failed = 0;
  let sessions = null;

  const testCase = async (name, fn) => {
    try {
      await fn();
      console.log(`[✓ PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[✗ FAIL] ${name}:`, err.message);
      failed++;
    }
  };

  try {
    sessions = await createAndLoginUsers(env.app, env.port);
    const { alice, bob, charlie } = sessions;

    const aliceUser = await User.findOne({ email: "alice@test.com" });
    const bobUser = await User.findOne({ email: "bob@test.com" });
    const charlieUser = await User.findOne({ email: "charlie@test.com" });

    const aliceId = String(aliceUser._id);
    const bobId = String(bobUser._id);
    const charlieId = String(charlieUser._id);

    // Set groupAddPermission to 'everyone' so group creation succeeds smoothly
    await User.updateMany(
      { _id: { $in: [aliceId, bobId, charlieId] } },
      { $set: { groupAddPermission: "everyone" } },
    );

    /* ================================================================ */
    /* 1. REST API & Multi-Device Sync for Activity & Read Receipts     */
    /* ================================================================ */

    await testCase("1.1 GET /api/v1/users/privacy returns activity & read receipts defaults", async () => {
      const res = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.readReceipts, true);
      assert.equal(res.body.data.typingIndicator, true);
    });

    await testCase("1.2 PATCH /api/v1/users/privacy updates readReceipts & typingIndicator", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: false, typingIndicator: false });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.readReceipts, false);
      assert.equal(res.body.data.typingIndicator, false);

      const dbUser = await User.findById(aliceId);
      assert.equal(dbUser.readReceipts, false);
      assert.equal(dbUser.typingIndicator, false);

      // Revert back for upcoming tests
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: true, typingIndicator: true });
    });

    await testCase("1.3 Multi-Device Sync: Secondary socket receives privacy update broadcast", async () => {
      // Connect a second socket for Alice (simulating second tab / mobile device)
      const aliceSocket2 = ioClient(`http://127.0.0.1:${env.port}`, {
        auth: { token: alice.accessToken },
        extraHeaders: { Cookie: alice.cookies },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise((resolve) => aliceSocket2.on("connect", resolve));

      const privacyUpdatePromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout waiting for privacy update")), 3000);
        aliceSocket2.on("privacy:settings-updated", (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });

      // Update privacy on primary device
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: false });

      const receivedData = await privacyUpdatePromise;
      assert.equal(receivedData.readReceipts, false);

      aliceSocket2.disconnect();

      // Reset Alice's read receipts to true
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: true, typingIndicator: true });
    });

    /* ================================================================ */
    /* 2. Direct Messaging Mutual Read Receipts Matrix                  */
    /* ================================================================ */

    await testCase("2.1 Direct Read Receipts: ON / ON allows blue checkmark ('seen')", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: true });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bob.cookies)
        .send({ readReceipts: true });

      // Alice sends message to Bob
      const sendRes = await request(env.app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello Bob ON/ON" });

      assert.equal(sendRes.status, 201);
      const msgId = sendRes.body.data._id || sendRes.body.data.id;

      // Bob marks seen
      const seenEventPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout waiting for messagesSeen")), 3000);
        alice.socket.once("messagesSeen", (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });

      const seenRes = await request(env.app)
        .patch(`/api/v1/messages/seen/${aliceId}`)
        .set("Cookie", bob.cookies);

      assert.equal(seenRes.status, 200);

      const seenEvent = await seenEventPromise;
      assert.equal(String(seenEvent.seenBy), bobId);

      // Verify Alice gets messages and status is 'seen'
      const aliceView = await request(env.app)
        .get(`/api/v1/messages/${bobId}`)
        .set("Cookie", alice.cookies);

      const sentMsg = aliceView.body.data.find((m) => String(m.id || m._id) === String(msgId));
      assert.equal(sentMsg.status, "seen");
    });

    await testCase("2.2 Direct Read Receipts: ON / OFF masks 'seen' to 'delivered'", async () => {
      // Alice has ON, Bob has OFF
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: true });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bob.cookies)
        .send({ readReceipts: false });

      let aliceReceivedSeenEvent = false;
      const seenHandler = () => { aliceReceivedSeenEvent = true; };
      alice.socket.on("messagesSeen", seenHandler);

      // Alice sends message to Bob
      const sendRes = await request(env.app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello Bob ON/OFF" });

      const msgId = sendRes.body.data._id || sendRes.body.data.id;

      // Bob marks seen
      const seenRes = await request(env.app)
        .patch(`/api/v1/messages/seen/${aliceId}`)
        .set("Cookie", bob.cookies);

      assert.equal(seenRes.status, 200);

      // Wait 300ms to ensure no socket event was emitted
      await new Promise((r) => setTimeout(r, 300));
      alice.socket.off("messagesSeen", seenHandler);
      assert.equal(aliceReceivedSeenEvent, false, "Alice should NOT receive messagesSeen socket event");

      // Alice fetches conversation: status MUST be 'delivered', not 'seen'
      const aliceView = await request(env.app)
        .get(`/api/v1/messages/${bobId}`)
        .set("Cookie", alice.cookies);

      const msg = aliceView.body.data.find((m) => String(m.id || m._id) === String(msgId));
      assert.equal(msg.status, "delivered", "status should be masked to delivered");

      // Bob also cannot see 'seen' status
      const bobView = await request(env.app)
        .get(`/api/v1/messages/${aliceId}`)
        .set("Cookie", bob.cookies);

      const bobMsg = bobView.body.data.find((m) => String(m.id || m._id) === String(msgId));
      assert.equal(bobMsg.status, "delivered");
    });

    await testCase("2.3 Direct Read Receipts: OFF / ON masks 'seen' to 'delivered'", async () => {
      // Alice has OFF, Bob has ON
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: false });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bob.cookies)
        .send({ readReceipts: true });

      // Alice sends message to Bob
      const sendRes = await request(env.app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello Bob OFF/ON" });

      const msgId = sendRes.body.data._id || sendRes.body.data.id;

      // Bob marks seen
      await request(env.app)
        .patch(`/api/v1/messages/seen/${aliceId}`)
        .set("Cookie", bob.cookies);

      // Alice fetches messages: status must be 'delivered'
      const aliceView = await request(env.app)
        .get(`/api/v1/messages/${bobId}`)
        .set("Cookie", alice.cookies);

      const msg = aliceView.body.data.find((m) => String(m.id || m._id) === String(msgId));
      assert.equal(msg.status, "delivered");
    });

    /* ================================================================ */
    /* 3. Group Messaging Mutual Read Receipts Matrix                   */
    /* ================================================================ */

    let groupId = null;
    await testCase("3.1 Create test group with Alice, Bob, and Charlie", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ readReceipts: true, typingIndicator: true });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bob.cookies)
        .send({ readReceipts: true, typingIndicator: true });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", charlie.cookies)
        .send({ readReceipts: false, typingIndicator: false });

      const createRes = await request(env.app)
        .post("/api/v1/groups")
        .set("Cookie", alice.cookies)
        .send({
          name: "Receipts & Activity Test Group",
          memberIds: JSON.stringify([bobId, charlieId]),
        });

      assert.equal(createRes.status, 201);
      groupId = createRes.body?.data?.id || createRes.body?.data?._id;
      assert.ok(groupId, "groupId must be defined");
    });

    await testCase("3.2 Group Read Receipts: Reader with readReceipts:true added to readBy", async () => {
      // Alice sends group message
      const sendRes = await request(env.app)
        .post(`/api/v1/groups/${groupId}/messages`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message 1 from Alice" });

      assert.equal(sendRes.status, 201);
      const msgId = sendRes.body?.data?.id || sendRes.body?.data?._id;

      // Bob (readReceipts: true) marks group seen
      const seenRes = await request(env.app)
        .post(`/api/v1/groups/${groupId}/seen`)
        .set("Cookie", bob.cookies);

      assert.equal(seenRes.status, 200);

      // Check group messages as Alice
      const aliceGroupView = await request(env.app)
        .get(`/api/v1/groups/${groupId}/messages`)
        .set("Cookie", alice.cookies);

      const msg = aliceGroupView.body.data.find((m) => String(m.id || m._id) === String(msgId));
      assert.ok(msg.readBy.some((r) => String(r.userId || r._id || r) === bobId), "Bob should be in readBy");
    });

    await testCase("3.3 Group Read Receipts: Reader with readReceipts:false routed to silentReadBy", async () => {
      // Alice sends another group message
      const sendRes = await request(env.app)
        .post(`/api/v1/groups/${groupId}/messages`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message 2 from Alice" });

      assert.equal(sendRes.status, 201);
      const msgId = sendRes.body?.data?.id || sendRes.body?.data?._id;

      // Charlie (readReceipts: false) marks group seen
      const seenRes = await request(env.app)
        .post(`/api/v1/groups/${groupId}/seen`)
        .set("Cookie", charlie.cookies);

      assert.equal(seenRes.status, 200);

      // DB inspection: Charlie is in silentReadBy, NOT in readBy
      const dbMsg = await GroupMessage.findById(msgId);
      assert.ok(dbMsg.silentReadBy.some((id) => String(id) === charlieId), "Charlie must be in silentReadBy");
      assert.ok(!dbMsg.readBy.some((r) => String(r.userId) === charlieId), "Charlie must NOT be in readBy");

      // Alice views messages: Charlie is NOT in readBy
      const aliceGroupView = await request(env.app)
        .get(`/api/v1/groups/${groupId}/messages`)
        .set("Cookie", alice.cookies);

      const visibleMsg = aliceGroupView.body.data.find((m) => String(m.id || m._id) === String(msgId));
      assert.ok(!visibleMsg.readBy.some((r) => String(r.userId || r._id || r) === charlieId), "Charlie must not be visible in readBy");
    });

    await testCase("3.4 Group Read Receipts: User with readReceipts:false sees empty readBy for all messages", async () => {
      // Charlie fetches group messages
      const charlieGroupView = await request(env.app)
        .get(`/api/v1/groups/${groupId}/messages`)
        .set("Cookie", charlie.cookies);

      assert.equal(charlieGroupView.status, 200);
      assert.ok(Array.isArray(charlieGroupView.body.data));
      for (const m of charlieGroupView.body.data) {
        assert.equal(m.readBy.length, 0, "Users with readReceipts:false must receive empty readBy");
      }
    });

    await testCase("3.5 Group Read Receipts: If sender has readReceipts:false, all reads are silentReadBy", async () => {
      // Charlie (readReceipts: false) sends message
      const sendRes = await request(env.app)
        .post(`/api/v1/groups/${groupId}/messages`)
        .set("Cookie", charlie.cookies)
        .send({ text: "Message from Charlie (receipts OFF)" });

      assert.equal(sendRes.status, 201);
      const msgId = sendRes.body?.data?.id || sendRes.body?.data?._id;

      // Bob (readReceipts: true) reads it
      await request(env.app)
        .post(`/api/v1/groups/${groupId}/seen`)
        .set("Cookie", bob.cookies);

      const dbMsg = await GroupMessage.findById(msgId);
      // Because sender (Charlie) has readReceipts: false, mutual privacy dictates Bob is silentReadBy
      assert.ok(dbMsg.silentReadBy.some((id) => String(id) === bobId), "Bob should be in silentReadBy due to sender's setting");
      assert.ok(!dbMsg.readBy.some((r) => String(r.userId) === bobId), "Bob should NOT be in readBy due to sender's setting");
    });

    /* ================================================================ */
    /* 4. Typing Indicator Suppression & Real-Time Lifecycle            */
    /* ================================================================ */

    await testCase("4.1 Direct Typing: ON / ON transmits typing indicator to peer", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ typingIndicator: true });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bob.cookies)
        .send({ typingIndicator: true });

      const typingReceivedPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timeout waiting for typing event")), 3000);
        bob.socket.once("typing", (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      alice.socket.emit("typing", { to: bobId, isTyping: true });

      const typingData = await typingReceivedPromise;
      assert.equal(String(typingData.from), aliceId);
      assert.equal(typingData.isTyping, true);
    });

    await testCase("4.2 Direct Typing: Sender with typingIndicator:false is dropped on server", async () => {
      // Alice turns typingIndicator OFF
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ typingIndicator: false });

      let bobReceivedTyping = false;
      const bobHandler = () => { bobReceivedTyping = true; };
      bob.socket.on("typing", bobHandler);

      alice.socket.emit("typing", { to: bobId, isTyping: true });

      await new Promise((r) => setTimeout(r, 300));
      bob.socket.off("typing", bobHandler);
      assert.equal(bobReceivedTyping, false, "Typing event must be dropped on server when sender has typingIndicator:false");
    });

    await testCase("4.3 Direct Typing: Receiver with typingIndicator:false is dropped on server", async () => {
      // Alice turns ON, Bob turns OFF
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ typingIndicator: true });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bob.cookies)
        .send({ typingIndicator: false });

      let bobReceivedTyping = false;
      const bobHandler = () => { bobReceivedTyping = true; };
      bob.socket.on("typing", bobHandler);

      alice.socket.emit("typing", { to: bobId, isTyping: true });

      await new Promise((r) => setTimeout(r, 300));
      bob.socket.off("typing", bobHandler);
      assert.equal(bobReceivedTyping, false, "Typing event must be dropped when receiver has typingIndicator:false");
    });

    await testCase("4.4 Active Typing Teardown on Privacy Disable", async () => {
      // Re-enable for Bob
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bob.cookies)
        .send({ typingIndicator: true });

      // Alice starts typing
      alice.socket.emit("typing", { to: bobId, isTyping: true });
      await new Promise((r) => setTimeout(r, 100));

      // Bob expects an immediate isTyping: false when Alice disables typingIndicator
      const stopTypingPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timeout waiting for stop typing")), 3000);
        bob.socket.on("typing", (data) => {
          if (String(data.from) === aliceId && data.isTyping === false) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });

      // Alice disables typingIndicator while actively typing
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", alice.cookies)
        .send({ typingIndicator: false });

      await stopTypingPromise;
    });

    await testCase("4.5 Group Typing: Member with typingIndicator:false is dropped on server", async () => {
      // Charlie has typingIndicator: false
      let receivedGroupTyping = false;
      const groupHandler = () => { receivedGroupTyping = true; };
      bob.socket.on("group:typing", groupHandler);

      charlie.socket.emit("group:typing", { groupId, isTyping: true });

      await new Promise((r) => setTimeout(r, 300));
      bob.socket.off("group:typing", groupHandler);
      assert.equal(receivedGroupTyping, false, "Group typing must be dropped when sender has typingIndicator:false");
    });

    await testCase("4.6 Group Typing: Member with typingIndicator:true broadcasts to group", async () => {
      // Bob has typingIndicator: true
      const typingPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timeout waiting for group typing")), 3000);
        alice.socket.once("group:typing", (data) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      bob.socket.emit("group:typing", { groupId, isTyping: true });

      const data = await typingPromise;
      assert.equal(String(data.groupId), String(groupId));
      assert.equal(String(data.userId), bobId);
      assert.equal(data.isTyping, true);
    });

  } finally {
    // Teardown sockets
    for (const s of Object.values(sessions?.allSessions || {})) {
      if (s.socket?.connected) s.socket.disconnect();
    }
    await teardownTestEnvironment(env);
  }

  console.log("==================================================");
  console.log(`ACTIVITY & READ RECEIPTS SUITE: Passed: ${passed} | Failed: ${failed}`);
  console.log("==================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runActivityReadReceiptsTests();
