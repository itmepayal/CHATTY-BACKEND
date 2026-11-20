import request from "supertest";
import mongoose from "mongoose";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import Notification from "../src/modules/notifications/models/notification.model.js";
import {
  sendMessageLimiter,
  settingsLimiter,
} from "../src/middlewares/rateLimit/index.js";

function waitForEvent(socket, eventName, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let timer = null;
    const handler = (data) => {
      if (timer) clearTimeout(timer);
      socket.off(eventName, handler);
      resolve({ received: true, data });
    };
    timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve({ received: false, data: null });
    }, timeoutMs);
    socket.once(eventName, handler);
  });
}

async function resetLimits(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(Boolean);
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await settingsLimiter.resetKey(k);
    } catch {}
  }
}

export const results = [];
function recordResult(category, testName, expected, actual, pass, evidence = "") {
  results.push({ category, testName, expected, actual, pass, evidence });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`[${symbol}] [${category}] ${testName}`);
  if (!pass) {
    console.error(`       Expected: ${expected}`);
    console.error(`       Actual:   ${actual}`);
    if (evidence) console.error(`       Evidence: ${JSON.stringify(evidence)}`);
  }
}

async function runGroupPinningTests() {
  console.log("\n==================================================");
  console.log("STARTING GROUP PINNING SYSTEM VERIFICATION SUITE");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie, david } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);
  const davidId = String(david.user._id);

  const resetAll = async () => {
    await resetLimits(aliceId, bobId, charlieId, davidId);
  };

  // Allow adding Bob & Charlie to groups
  await mongoose.model("User").updateMany(
    { _id: { $in: [bobId, charlieId] } },
    { $set: { groupAddPermission: "everyone" } },
  );

  let groupId = null;
  const messageIds = [];

  try {
    await resetAll();

    // 1. Setup: Create test group with Alice (owner), Bob, and Charlie
    {
      const res = await request(app)
        .post("/api/v1/groups")
        .set("Cookie", alice.cookies)
        .send({
          name: "Project Titan",
          memberIds: JSON.stringify([bobId, charlieId]),
        });
      const pass = res.status === 201 && res.body?.data?.name === "Project Titan";
      groupId = res.body?.data?.id || res.body?.data?._id;
      recordResult("Setup", "Create group for pinning tests", 201, res.status, pass);
    }

    // Join group rooms on Bob's socket to test socket events
    bob.socket.emit("group:join", { groupId });

    // 2. Send 7 messages to test pinning and limit
    for (let i = 1; i <= 7; i++) {
      await resetAll();
      const res = await request(app)
        .post(`/api/v1/groups/${groupId}/messages`)
        .set("Cookie", i % 2 === 1 ? alice.cookies : bob.cookies)
        .field("text", `Announcement #${i} - Important details`)
        .field("clientId", `client-pin-${i}-${Date.now()}`);

      if (res.status === 201 && res.body?.data?.id) {
        messageIds.push(res.body.data.id);
      }
    }
    recordResult("Setup", "Sent test messages into group", 7, messageIds.length, messageIds.length === 7);

    // 3. Test: Admin (Alice) pins Message 1
    {
      await resetAll();
      const pinPromise = waitForEvent(bob.socket, "group:messagePinned", 2000);

      const res = await request(app)
        .patch(`/api/v1/groups/${groupId}/messages/${messageIds[0]}/pin`)
        .set("Cookie", alice.cookies);

      const socketEvt = await pinPromise;

      const pass =
        res.status === 200 &&
        res.body?.data?.isPinned === true &&
        res.body?.data?.groupId === String(groupId) &&
        res.body?.data?.messageId === String(messageIds[0]) &&
        socketEvt.received === true &&
        socketEvt.data?.isPinned === true;

      recordResult(
        "Admin Pinning",
        "Admin can pin message and emit real-time socket event",
        200,
        res.status,
        pass,
        { body: res.body?.data, socketReceived: socketEvt.received },
      );
    }

    // 4. Test: Notification created for group members
    {
      const notifs = await Notification.find({
        recipientId: bobId,
        type: "group_message_pinned",
      });
      const pass = notifs.length >= 1 && String(notifs[0].data?.groupId) === String(groupId);
      recordResult(
        "Notifications",
        "Group message pin dispatches centralized notification to members",
        true,
        pass,
        pass,
        { count: notifs.length },
      );
    }

    // 5. Test: GET /api/v1/groups/:id/messages/pinned
    {
      const res = await request(app)
        .get(`/api/v1/groups/${groupId}/messages/pinned`)
        .set("Cookie", bob.cookies);

      const pass =
        res.status === 200 &&
        Array.isArray(res.body?.data) &&
        res.body.data.length === 1 &&
        res.body.data[0].id === messageIds[0] &&
        res.body.data[0].isPinned === true &&
        Boolean(res.body.data[0].sender);

      recordResult(
        "Pinned API",
        "GET /api/v1/groups/:id/messages/pinned returns active pinned messages with populated details",
        200,
        res.status,
        pass,
        { count: res.body?.data?.length },
      );
    }

    // 6. Test: Regular member (Bob) pins Message 2 when whoCanPin === 'all' (default)
    {
      await resetAll();
      const res = await request(app)
        .patch(`/api/v1/groups/${groupId}/messages/${messageIds[1]}/pin`)
        .set("Cookie", bob.cookies);

      const pass =
        res.status === 200 &&
        res.body?.data?.isPinned === true &&
        res.body?.data?.messageId === String(messageIds[1]);

      recordResult(
        "Member Pinning",
        "Regular member can pin when whoCanPin is 'all'",
        200,
        res.status,
        pass,
        res.body?.data,
      );
    }

    // 7. Test: Update group whoCanPin setting to 'admins'
    {
      await resetAll();
      const res = await request(app)
        .patch(`/api/v1/groups/${groupId}`)
        .set("Cookie", alice.cookies)
        .send({ whoCanPin: "admins" });

      const pass = res.status === 200 && res.body?.data?.whoCanPin === "admins";
      recordResult(
        "Group Settings",
        "Admin updates whoCanPin setting to 'admins'",
        "admins",
        res.body?.data?.whoCanPin,
        pass,
      );
    }

    // 8. Test: Regular member (Bob) blocked from pinning when whoCanPin === 'admins'
    {
      await resetAll();
      const res = await request(app)
        .patch(`/api/v1/groups/${groupId}/messages/${messageIds[2]}/pin`)
        .set("Cookie", bob.cookies);

      const pass = res.status === 403;
      recordResult(
        "Permissions",
        "Regular member rejected with 403 when whoCanPin is 'admins'",
        403,
        res.status,
        pass,
        res.body?.message,
      );
    }

    // 9. Test: Regular member blocked from unpinning when whoCanPin === 'admins'
    {
      await resetAll();
      const res = await request(app)
        .patch(`/api/v1/groups/${groupId}/messages/${messageIds[0]}/pin`)
        .set("Cookie", bob.cookies);

      const pass = res.status === 403;
      recordResult(
        "Permissions",
        "Regular member rejected with 403 on unpin when whoCanPin is 'admins'",
        403,
        res.status,
        pass,
        res.body?.message,
      );
    }

    // 10. Test: Admin can unpin and pin freely
    {
      await resetAll();
      const res = await request(app)
        .patch(`/api/v1/groups/${groupId}/messages/${messageIds[1]}/pin`)
        .set("Cookie", alice.cookies);

      const pass = res.status === 200 && res.body?.data?.isPinned === false;
      recordResult(
        "Admin Pinning",
        "Admin unpins message successfully",
        false,
        res.body?.data?.isPinned,
        pass,
      );
    }

    // 11. Test: Max 5 pinned messages limit enforcement
    {
      // Currently messageIds[0] is pinned (1 pinned). Pin messages 1, 2, 3, 4 to reach 5
      await resetAll();
      await request(app).patch(`/api/v1/groups/${groupId}/messages/${messageIds[1]}/pin`).set("Cookie", alice.cookies);
      await resetAll();
      await request(app).patch(`/api/v1/groups/${groupId}/messages/${messageIds[2]}/pin`).set("Cookie", alice.cookies);
      await resetAll();
      await request(app).patch(`/api/v1/groups/${groupId}/messages/${messageIds[3]}/pin`).set("Cookie", alice.cookies);
      await resetAll();
      await request(app).patch(`/api/v1/groups/${groupId}/messages/${messageIds[4]}/pin`).set("Cookie", alice.cookies);

      // Now 5 messages are pinned: [0, 1, 2, 3, 4]
      // Try to pin the 6th message (messageIds[5])
      await resetAll();
      const res = await request(app)
        .patch(`/api/v1/groups/${groupId}/messages/${messageIds[5]}/pin`)
        .set("Cookie", alice.cookies);

      const pass = res.status === 400 && res.body?.message?.includes("5 messages");
      recordResult(
        "Limit Enforcement",
        "Enforce max 5 pinned messages per group with 400 error",
        400,
        res.status,
        pass,
        res.body?.message,
      );
    }

    // 12. Test: Non-member (David) rejected with 403 or 404
    {
      await resetAll();
      const resPin = await request(app)
        .patch(`/api/v1/groups/${groupId}/messages/${messageIds[0]}/pin`)
        .set("Cookie", david.cookies);

      const resGet = await request(app)
        .get(`/api/v1/groups/${groupId}/messages/pinned`)
        .set("Cookie", david.cookies);

      const pass = (resPin.status === 403 || resPin.status === 404) && (resGet.status === 403 || resGet.status === 404);
      recordResult(
        "Security",
        "Non-member rejected from pinning or reading group pinned messages",
        true,
        pass,
        pass,
        { pinStatus: resPin.status, getStatus: resGet.status },
      );
    }

    // 13. Test: Personal chat pin continues to work independently
    {
      await resetAll();
      // Send a DM from Alice to Bob
      const dmRes = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello Bob direct message" });

      const dmMsgId = dmRes.body?.data?.id || dmRes.body?.data?._id;

      if (dmMsgId) {
        await resetAll();
        const pinDmRes = await request(app)
          .patch(`/api/v1/messages/pin/${dmMsgId}`)
          .set("Cookie", alice.cookies);

        const pass = pinDmRes.status === 200 && pinDmRes.body?.data?.isPinned === true;
        recordResult(
          "Personal Pin",
          "Personal chat message pinning works cleanly with zero regression",
          200,
          pinDmRes.status,
          pass,
          pinDmRes.body?.data,
        );
      }
    }

  } finally {
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass).length;
    console.log("\n==================================================");
    console.log(`GROUP PINNING SUITE: Passed: ${passed} | Failed: ${failed}`);
    console.log("==================================================\n");

    await new Promise((r) => setTimeout(r, 300));
    await teardownTestEnvironment(env);
  }
}

runGroupPinningTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
