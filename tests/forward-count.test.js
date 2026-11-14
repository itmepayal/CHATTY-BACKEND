import assert from "node:assert/strict";
import mongoose from "mongoose";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import Message from "../src/modules/messaging/models/message.model.js";
import { sendMessage } from "../src/modules/messaging/services/sending/message-send.service.js";
import { forwardMessage } from "../src/modules/messaging/services/sending/message-forward.service.js";
import { getUsersForSidebar } from "../src/modules/messaging/services/querying/sidebar.service.js";
import * as contactRepo from "../src/modules/contacts/repositories/contact.repository.js";
import * as contactService from "../src/modules/contacts/services/contact.service.js";
import User from "../src/modules/users/models/users.model.js";

async function runTests() {
  console.log("Setting up test environment...");
  const env = await setupTestEnvironment();
  let passed = 0;
  let failed = 0;

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
    const sessions = await createAndLoginUsers(env.app, env.port);
    const { alice, bob, charlie, david } = sessions;

    // Unblock David for Alice so David can receive forwards
    await User.updateOne({ _id: alice.user._id }, { $set: { blockedUsers: [] } });

    const aliceId = alice.user._id.toString();
    const bobId = bob.user._id.toString();
    const charlieId = charlie.user._id.toString();
    const davidId = david.user._id.toString();

    // Event capture queues
    const events = { alice: [], bob: [], charlie: [], david: [] };
    const setupListeners = () => {
      const activeSessions = { alice, bob, charlie, david };
      for (const [name, sess] of Object.entries(activeSessions)) {
        if (sess && sess.socket) {
          events[name] = [];
          sess.socket.on("newMessage", (data) => events[name].push({ event: "newMessage", data }));
          sess.socket.on("conversationUpdated", (data) => events[name].push({ event: "conversationUpdated", data }));
          sess.socket.on("messagesSeen", (data) => events[name].push({ event: "messagesSeen", data }));
        }
      }
    };
    setupListeners();

    // 1. Initial direct message: Alice -> Bob
    await testCase("1. Direct messaging updates unread count correctly", async () => {
      events.bob.length = 0;
      events.alice.length = 0;

      const sent = await sendMessage(alice.user._id, bobId, { text: "Hello Bob" });
      assert.ok(sent.payload.id);

      await new Promise((r) => setTimeout(r, 100));

      const bobUpdated = events.bob.find((e) => e.event === "conversationUpdated");
      assert.ok(bobUpdated, "Bob should receive conversationUpdated");
      assert.equal(bobUpdated.data.userId, aliceId);
      assert.equal(bobUpdated.data.unreadCount, 1);

      const aliceUpdated = events.alice.find((e) => e.event === "conversationUpdated");
      assert.ok(aliceUpdated, "Alice should receive conversationUpdated");
      assert.equal(aliceUpdated.data.userId, bobId);
      assert.equal(aliceUpdated.data.unreadCount, 0);

      const bobSidebar = await getUsersForSidebar(bob.user._id);
      const aliceEntryForBob = bobSidebar.response.find((u) => u.id.toString() === aliceId);
      assert.ok(aliceEntryForBob);
      assert.equal(aliceEntryForBob.unreadCount, 1);
      assert.equal(aliceEntryForBob.lastMessage.text, "Hello Bob");
    });

    // 2. Forward single message to one user (Alice -> Charlie)
    let originalMsgId;
    await testCase("2. Forward single message to one closed-chat recipient", async () => {
      const msgs = await Message.find({ senderId: alice.user._id, receiverId: bob.user._id });
      originalMsgId = msgs[0]._id.toString();

      events.charlie.length = 0;
      events.alice.length = 0;

      const fwd = await forwardMessage(alice.user._id, originalMsgId, {
        userIds: [charlieId],
      });
      assert.equal(fwd.sent.length, 1);
      assert.equal(fwd.failed.length, 0);

      await new Promise((r) => setTimeout(r, 150));

      const charlieMsg = events.charlie.find((e) => e.event === "newMessage");
      assert.ok(charlieMsg, "Charlie should receive newMessage");
      assert.equal(charlieMsg.data.isForwarded, true);
      assert.equal(charlieMsg.data.text, "Hello Bob");

      const charlieUpdated = events.charlie.find((e) => e.event === "conversationUpdated");
      assert.ok(charlieUpdated, "Charlie should receive conversationUpdated");
      assert.equal(charlieUpdated.data.userId, aliceId);
      assert.equal(charlieUpdated.data.unreadCount, 1);

      const aliceUpdated = events.alice.find((e) => e.event === "conversationUpdated" && e.data.userId === charlieId);
      assert.ok(aliceUpdated, "Alice should receive conversationUpdated for Charlie");
      assert.equal(aliceUpdated.data.unreadCount, 0);
      assert.equal(aliceUpdated.data.lastMessage.isForwarded, true);

      const forwardedDoc = await Message.findById(fwd.sent[0].id);
      assert.equal(forwardedDoc.isForwarded, true);
      assert.equal(forwardedDoc.status, "delivered");
      assert.equal(forwardedDoc.receiverReadAt, null);

      const charlieSidebar = await getUsersForSidebar(charlie.user._id);
      const aliceEntry = charlieSidebar.response.find((u) => u.id.toString() === aliceId);
      assert.ok(aliceEntry);
      assert.equal(aliceEntry.unreadCount, 1);
      assert.equal(aliceEntry.lastMessage.text, "Hello Bob");

      const aliceSidebar = await getUsersForSidebar(alice.user._id);
      const charlieEntry = aliceSidebar.response.find((u) => u.id.toString() === charlieId);
      assert.ok(charlieEntry);
      assert.equal(charlieEntry.unreadCount, 0);
      assert.equal(charlieEntry.lastMessage.text, "Hello Bob");
    });

    // 3. Forward multiple messages to one user (Alice -> Charlie)
    await testCase("3. Forward multiple messages sequentially to one recipient increments count", async () => {
      const secondMsg = await sendMessage(alice.user._id, bobId, { text: "Second message from A" });
      const secondMsgId = secondMsg.payload.id;

      events.charlie.length = 0;

      const fwd2 = await forwardMessage(alice.user._id, secondMsgId, {
        userIds: [charlieId],
      });
      assert.equal(fwd2.sent.length, 1);

      await new Promise((r) => setTimeout(r, 150));

      const charlieUpdated = events.charlie.filter((e) => e.event === "conversationUpdated");
      assert.ok(charlieUpdated.length >= 1);
      const latestUpdate = charlieUpdated[charlieUpdated.length - 1];
      assert.equal(latestUpdate.data.unreadCount, 2);

      const charlieSidebar = await getUsersForSidebar(charlie.user._id);
      const aliceEntry = charlieSidebar.response.find((u) => u.id.toString() === aliceId);
      assert.ok(aliceEntry);
      assert.equal(aliceEntry.unreadCount, 2);
      assert.equal(aliceEntry.lastMessage.text, "Second message from A");
    });

    // 4. Forward single message to multiple users at once
    await testCase("4. Forward single message to multiple recipients", async () => {
      events.charlie.length = 0;
      events.david.length = 0;

      const fwdMulti = await forwardMessage(alice.user._id, originalMsgId, {
        userIds: [charlieId, davidId],
      });
      assert.equal(fwdMulti.sent.length, 2);

      await new Promise((r) => setTimeout(r, 150));

      const charlieSidebar = await getUsersForSidebar(charlie.user._id);
      const aliceForCharlie = charlieSidebar.response.find((u) => u.id.toString() === aliceId);
      assert.equal(aliceForCharlie.unreadCount, 3);

      const davidSidebar = await getUsersForSidebar(david.user._id);
      const aliceForDavid = davidSidebar.response.find((u) => u.id.toString() === aliceId);
      assert.equal(aliceForDavid.unreadCount, 1);
      assert.equal(aliceForDavid.lastMessage.text, "Hello Bob");
    });

    // 5. Forwarding to an open chat vs closed chat
    await testCase("5. Forwarding to open chat marks message seen with unreadCount 0", async () => {
      charlie.socket.emit("chat:open", aliceId);
      await new Promise((r) => setTimeout(r, 100));

      events.charlie.length = 0;
      events.alice.length = 0;

      const fwdOpen = await forwardMessage(alice.user._id, originalMsgId, {
        userIds: [charlieId],
      });
      assert.equal(fwdOpen.sent.length, 1);

      await new Promise((r) => setTimeout(r, 150));

      const openDoc = await Message.findById(fwdOpen.sent[0].id);
      assert.equal(openDoc.status, "seen");
      assert.ok(openDoc.receiverReadAt);

      charlie.socket.emit("chat:close");
      await new Promise((r) => setTimeout(r, 100));

      const fwdClosed = await forwardMessage(alice.user._id, originalMsgId, {
        userIds: [charlieId],
      });
      assert.equal(fwdClosed.sent.length, 1);

      await new Promise((r) => setTimeout(r, 150));

      const closedDoc = await Message.findById(fwdClosed.sent[0].id);
      assert.equal(closedDoc.status, "delivered");
      assert.equal(closedDoc.receiverReadAt, null);
    });

    // 6. Forwarding to offline recipient
    await testCase("6. Forwarding to offline recipient preserves message and unread count", async () => {
      david.socket.disconnect();
      await new Promise((r) => setTimeout(r, 150));

      const fwdOffline = await forwardMessage(alice.user._id, originalMsgId, {
        userIds: [davidId],
      });
      assert.equal(fwdOffline.sent.length, 1);

      const offlineDoc = await Message.findById(fwdOffline.sent[0].id);
      assert.equal(offlineDoc.status, "sent");
      assert.equal(offlineDoc.receiverReadAt, null);

      const davidSidebar = await getUsersForSidebar(david.user._id);
      const aliceForDavid = davidSidebar.response.find((u) => u.id.toString() === aliceId);
      assert.equal(aliceForDavid.unreadCount, 2);
    });

    // 7. Contact Chat List Aggregation (/contacts/chats & getChatList)
    await testCase("7. Contact chat list correctly returns unread and lastMessage", async () => {
      await contactRepo.upsertContact(charlie.user._id, alice.user._id);

      const chatListResult = await contactService.getChatList(charlie.user._id);
      assert.ok(chatListResult.chats.length >= 1);

      const aliceChat = chatListResult.chats.find((c) => c.user._id.toString() === aliceId);
      assert.ok(aliceChat, "Alice should be in Charlie's contact chat list");
      assert.ok(aliceChat.lastMessage !== null, "lastMessage must not be null");
      assert.ok(typeof aliceChat.unread === "number", "unread must be a number");
      assert.ok(aliceChat.unread > 0, "unread count must be > 0");
    });

    // 8. E2EE Forward flow with envelopes
    await testCase("8. E2EE Forward flow with key envelopes preserves security payload", async () => {
      const validIv = Buffer.alloc(12, 1).toString("base64");
      const validCipher = Buffer.alloc(32, 2).toString("base64");
      const charlieIv = Buffer.alloc(12, 3).toString("base64");
      const charlieCipher = Buffer.alloc(32, 4).toString("base64");

      const e2eeSent = await sendMessage(alice.user._id, bobId, {
        text: validCipher,
        e2ee: true,
        iv: validIv,
        keyEnvelopes: [
          {
            deviceId: "bob_dev_1",
            userId: bob.user._id,
            wrappedKey: "wrapped_bob_key",
            iv: validIv,
          },
        ],
      });
      const e2eeMsgId = e2eeSent.payload.id;

      const e2eeFwd = await forwardMessage(alice.user._id, e2eeMsgId, {
        userIds: [charlieId],
        ciphertexts: [
          {
            userId: charlieId,
            text: charlieCipher,
            iv: charlieIv,
            keyEnvelopes: [
              {
                deviceId: "charlie_dev_1",
                userId: charlie.user._id,
                wrappedKey: "wrapped_charlie_key",
                iv: charlieIv,
              },
            ],
          },
        ],
      });

      assert.equal(e2eeFwd.sent.length, 1);
      assert.equal(e2eeFwd.sent[0].encrypted, true);
      assert.equal(e2eeFwd.sent[0].text, charlieCipher);
      assert.equal(e2eeFwd.sent[0].iv, charlieIv);
      assert.equal(e2eeFwd.sent[0].keyEnvelopes.length, 1);
      assert.equal(e2eeFwd.sent[0].keyEnvelopes[0].deviceId, "charlie_dev_1");

      const dbDoc = await Message.findById(e2eeFwd.sent[0].id);
      assert.equal(dbDoc.e2ee, true);
      assert.equal(dbDoc.text, charlieCipher);
      assert.equal(dbDoc.keyEnvelopes.length, 1);
    });

    // Disconnect remaining sockets
    alice.socket.disconnect();
    bob.socket.disconnect();
    charlie.socket.disconnect();

    console.log(`\n========================================`);
    console.log(`TESTS SUMMARY: ${passed} Passed | ${failed} Failed`);
    console.log(`========================================\n`);

  } finally {
    await teardownTestEnvironment(env);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
