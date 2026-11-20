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

async function runGroupMentionTests() {
  console.log("\n==================================================");
  console.log("STARTING GROUP @MENTION SYSTEM VERIFICATION SUITE");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie, david } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);
  const davidId = String(david.user._id);

  let groupId = null;
  let testMsgId = null;

  try {
    await resetLimits(aliceId, bobId, charlieId, davidId);

    // 1. Setup: Create a group with Alice (admin), Bob (member), and Charlie (member). David is NOT a member.
    const createGroupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({
        name: "Mention Test Lab",
        members: [bobId, charlieId],
      });

    const isGroupCreated = createGroupRes.status === 201 && createGroupRes.body.success;
    recordResult(
      "Setup",
      "Create group for mention tests",
      true,
      isGroupCreated,
      isGroupCreated,
      createGroupRes.body
    );
    groupId = createGroupRes.body.data.id;

    // 2. Member data includes username for autocomplete
    const groupDataRes = await request(app)
      .get(`/api/v1/groups/${groupId}`)
      .set("Cookie", alice.cookies);

    const membersHaveUsername = groupDataRes.body.data?.members?.every(
      (m) => typeof m.username === "string" && typeof m.fullName === "string"
    );
    recordResult(
      "Autocomplete Data",
      "Group members include username and fullName for mention filtering",
      true,
      Boolean(membersHaveUsername),
      Boolean(membersHaveUsername),
      groupDataRes.body.data?.members
    );

    // 3. Alice sends a group message mentioning Bob
    const bobNotifPromise = waitForEvent(bob.socket, "notification:new", 3000);

    const sendMentionRes = await request(app)
      .post(`/api/v1/groups/${groupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "Hey @Bob please review the PR")
      .field(
        "mentions",
        JSON.stringify([
          { userId: bobId, startIndex: 4, length: 4 }
        ])
      );

    const sendSuccess = sendMentionRes.status === 201 && sendMentionRes.body.success;
    testMsgId = sendMentionRes.body.data?.id;
    const hasMentions =
      sendMentionRes.body.data?.mentions?.length === 1 &&
      String(sendMentionRes.body.data.mentions[0].user?.id || sendMentionRes.body.data.mentions[0].userId) === bobId;

    recordResult(
      "Send Mention",
      "Alice sends message mentioning Bob and mentions array is persisted and populated",
      true,
      sendSuccess && hasMentions,
      sendSuccess && hasMentions,
      sendMentionRes.body.data
    );

    // 4. Bob receives real-time notification socket event
    const bobNotif = await bobNotifPromise;
    const notifReceived =
      bobNotif.received &&
      bobNotif.data?.type === "group_mention" &&
      String(bobNotif.data?.data?.groupId) === String(groupId);

    recordResult(
      "Real-time Notification",
      "Bob receives real-time 'notification:new' socket event of type 'group_mention'",
      true,
      notifReceived,
      notifReceived,
      bobNotif.data
    );

    // 5. Check persisted notification in MongoDB for Bob
    const dbNotif = await Notification.findOne({
      recipientId: bobId,
      type: "group_mention",
      "data.groupId": groupId,
    }).lean();

    const notifPersisted =
      Boolean(dbNotif) &&
      dbNotif.title === "You were mentioned" &&
      dbNotif.body.includes("Mention Test Lab");

    recordResult(
      "Notification Persistence",
      "Centralized Notification document created in database for mentioned member",
      true,
      notifPersisted,
      notifPersisted,
      dbNotif
    );

    // 6. Sender (Alice) does NOT receive a mention notification
    const aliceDbNotif = await Notification.findOne({
      recipientId: aliceId,
      type: "group_mention",
      "data.groupId": groupId,
    }).lean();

    recordResult(
      "Notification Suppression",
      "Sender does not receive a mention notification for their own message",
      null,
      aliceDbNotif,
      aliceDbNotif === null
    );

    // 7. Security: Filter out self-mentions and non-group members
    const securityMentionRes = await request(app)
      .post(`/api/v1/groups/${groupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "Tagging @Alice (self) and @David (non-member)")
      .field(
        "mentions",
        JSON.stringify([
          { userId: aliceId }, // Self-mention: should be filtered
          { userId: davidId }, // Non-member: should be filtered
          { userId: "invalid-id-format" }, // Invalid ID: should be filtered
        ])
      );

    const securityMentions = securityMentionRes.body.data?.mentions || [];
    const properlyFiltered = securityMentions.length === 0;

    recordResult(
      "Security Validation",
      "Self-mentions, non-members, and invalid IDs are strictly filtered from mentions array",
      0,
      securityMentions.length,
      properlyFiltered,
      securityMentions
    );

    // 8. Deduplication: Mentioning the same user multiple times yields 1 mention
    const dedupRes = await request(app)
      .post(`/api/v1/groups/${groupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "Hey @Bob and again @Bob")
      .field(
        "mentions",
        JSON.stringify([
          { userId: bobId },
          { userId: bobId },
        ])
      );

    const dedupMentions = dedupRes.body.data?.mentions || [];
    const dedupPassed = dedupMentions.length === 1;

    recordResult(
      "Deduplication",
      "Duplicate mentions for the same user are deduplicated into a single entry",
      1,
      dedupMentions.length,
      dedupPassed,
      dedupMentions
    );

    // 9. Edit message with mentions: Alice edits message to mention Charlie
    const charlieNotifPromise = waitForEvent(charlie.socket, "notification", 3000);

    const editRes = await request(app)
      .patch(`/api/v1/groups/${groupId}/messages/${testMsgId}`)
      .set("Cookie", alice.cookies)
      .send({
        text: "Edited: Hey @Charlie please review instead",
        mentions: JSON.stringify([{ userId: charlieId }]),
      });

    const editPassed =
      editRes.status === 200 &&
      editRes.body.success &&
      editRes.body.data?.mentions?.length === 1 &&
      String(editRes.body.data.mentions[0].user?.id || editRes.body.data.mentions[0].userId) === charlieId;

    recordResult(
      "Edit Message",
      "Editing a group message correctly updates the mentions array with populated details",
      true,
      editPassed,
      editPassed,
      editRes.body.data
    );

    // 10. Normal group message without mentions works with zero regressions
    const normalMsgRes = await request(app)
      .post(`/api/v1/groups/${groupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "Just a plain message with no mentions");

    const normalPassed = normalMsgRes.status === 201 && normalMsgRes.body.success;
    recordResult(
      "Backward Compatibility",
      "Normal group messaging without mentions continues working seamlessly",
      true,
      normalPassed,
      normalPassed,
      normalMsgRes.body
    );

  } finally {
    // Teardown
    alice.socket.disconnect();
    bob.socket.disconnect();
    charlie.socket.disconnect();
    david.socket.disconnect();
    await teardownTestEnvironment(env);
  }

  const passedCount = results.filter((r) => r.pass).length;
  const failedCount = results.filter((r) => !r.pass).length;
  console.log("\n==================================================");
  console.log(`GROUP @MENTION SUITE: Passed: ${passedCount} | Failed: ${failedCount}`);
  console.log("==================================================\n");

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

runGroupMentionTests();
