import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import {
  sendMessageLimiter,
  settingsLimiter,
  reactLimiter,
} from "../src/middlewares/rateLimit/index.js";

async function resetLimiters(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(
    Boolean
  );
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await settingsLimiter.resetKey(k);
      await reactLimiter.resetKey(k);
    } catch {}
  }
}

test("Thread Reply System & Timeline Isolation Verification Suite", async (t) => {
  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie, david } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);
  const davidId = String(david.user._id);

  const resetLimits = async () => {
    await resetLimiters(aliceId, bobId, charlieId, davidId);
  };

  await resetLimits();

  let directParentId = null;
  let directReplyId = null;
  let testGroupId = null;
  let groupParentId = null;
  let groupReplyId = null;

  await t.test("1. Direct Chat Thread: Parent message creation & thread replies", async () => {
    await resetLimits();

    // Alice sends parent message to Bob
    const sendRes = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .field("text", "Direct thread root message");
    assert.equal(sendRes.status, 201);
    directParentId = sendRes.body?.data?.id || sendRes.body?.data?._id;
    assert.ok(directParentId, "Parent message ID must exist");

    // Bob views empty thread
    const emptyThreadRes = await request(app)
      .get(`/api/v1/messages/${directParentId}/thread`)
      .set("Cookie", bob.cookies);
    assert.equal(emptyThreadRes.status, 200);
    assert.equal(emptyThreadRes.body?.data?.totalReplies, 0);
    assert.equal(emptyThreadRes.body?.data?.replies?.length, 0);

    // Bob replies in thread
    const replyRes = await request(app)
      .post(`/api/v1/messages/${directParentId}/thread`)
      .set("Cookie", bob.cookies)
      .send({ text: "Bob reply 1 in thread" });
    assert.equal(replyRes.status, 201);
    const replyData = replyRes.body?.data?.reply || replyRes.body?.data;
    directReplyId = replyData.id || replyData._id;
    assert.ok(directReplyId, "Reply ID must exist");
    assert.equal(replyData.parentMessageId, directParentId);
    assert.equal(replyRes.body?.data?.parentMessage?.threadReplyCount, 1);

    // Alice also replies in thread
    const reply2Res = await request(app)
      .post(`/api/v1/messages/${directParentId}/thread`)
      .set("Cookie", alice.cookies)
      .send({ text: "Alice reply 2 in thread" });
    assert.equal(reply2Res.status, 201);
    assert.equal(reply2Res.body?.data?.parentMessage?.threadReplyCount, 2);

    // Get thread replies
    const getThreadRes = await request(app)
      .get(`/api/v1/messages/${directParentId}/thread`)
      .set("Cookie", alice.cookies);
    assert.equal(getThreadRes.status, 200);
    assert.equal(getThreadRes.body?.data?.totalReplies, 2);
    assert.equal(getThreadRes.body?.data?.replies?.length, 2);
  });

  await t.test("2. Direct Chat Timeline Isolation: replies do NOT appear in main timeline", async () => {
    await resetLimits();

    // Alice fetches main conversation messages with Bob
    const convoRes = await request(app)
      .get(`/api/v1/messages/${bobId}`)
      .set("Cookie", alice.cookies);
    assert.equal(convoRes.status, 200);

    const msgs = convoRes.body?.data?.messages || convoRes.body?.data || [];
    // Verify parent is present
    const parentMsg = msgs.find((m) => String(m.id || m._id) === String(directParentId));
    assert.ok(parentMsg, "Parent message should appear in main timeline");
    assert.equal(parentMsg.threadReplyCount, 2);

    // Verify replies are NOT present in main timeline
    const replyMsg = msgs.find((m) => String(m.id || m._id) === String(directReplyId));
    assert.equal(replyMsg, undefined, "Thread reply must NOT appear in main conversation timeline");

    // Any message with parentMessageId set should not be in main timeline
    const leakingReplies = msgs.filter((m) => m.parentMessageId);
    assert.equal(leakingReplies.length, 0, "No messages with parentMessageId in main timeline");
  });

  await t.test("3. Direct Chat Thread Security: non-participant cannot access thread", async () => {
    await resetLimits();

    // Charlie is not a participant in Alice-Bob conversation
    const res = await request(app)
      .get(`/api/v1/messages/${directParentId}/thread`)
      .set("Cookie", charlie.cookies);
    assert.equal(res.status, 403, "Non-participant must be forbidden from accessing thread");
  });

  await t.test("4. Group Chat Thread: Parent creation, thread replies & timeline isolation", async () => {
    await resetLimits();

    // Alice creates group with Bob and Charlie
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({
        name: "Thread Test Group",
        memberIds: JSON.stringify([bobId, charlieId]),
      });
    assert.equal(groupRes.status, 201);
    testGroupId = groupRes.body?.data?.id || groupRes.body?.data?._id;

    // Alice sends parent group message
    const parentMsgRes = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "Group thread root message");
    assert.equal(parentMsgRes.status, 201);
    groupParentId = parentMsgRes.body?.data?.id || parentMsgRes.body?.data?._id;
    assert.ok(groupParentId, "Group parent message ID must exist");

    // Bob replies in group thread
    const replyRes = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages/${groupParentId}/thread`)
      .set("Cookie", bob.cookies)
      .send({ text: "Bob group reply in thread" });
    assert.equal(replyRes.status, 201);
    const replyData = replyRes.body?.data?.reply || replyRes.body?.data;
    groupReplyId = replyData.id || replyData._id;
    assert.ok(groupReplyId, "Group reply ID must exist");
    assert.equal(replyData.parentMessageId, groupParentId);

    // Verify sender info in reply
    assert.ok(replyData.sender, "Reply must contain populated sender info");
    assert.equal(replyData.sender.fullName, bob.user.fullName);

    // Main group timeline should NOT contain the thread reply
    const mainTimelineRes = await request(app)
      .get(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies);
    assert.equal(mainTimelineRes.status, 200);

    const groupMsgs = mainTimelineRes.body?.data?.messages || mainTimelineRes.body?.data || [];
    const foundParent = groupMsgs.find((m) => String(m.id || m._id) === String(groupParentId));
    assert.ok(foundParent, "Parent message should exist in main group timeline");
    assert.equal(foundParent.threadReplyCount, 1);

    const foundReply = groupMsgs.find((m) => String(m.id || m._id) === String(groupReplyId));
    assert.equal(foundReply, undefined, "Group thread reply must NOT appear in main group timeline");
  });

  await t.test("5. Group Chat Thread Security: non-member cannot access thread", async () => {
    await resetLimits();

    // David is not a member of the group
    const res = await request(app)
      .get(`/api/v1/groups/${testGroupId}/messages/${groupParentId}/thread`)
      .set("Cookie", david.cookies);
    assert.equal(res.status, 403, "Non-member must be forbidden from accessing group thread");
  });

  await t.test("6. Thread Reply Deletion: decrements reply count on parent", async () => {
    await resetLimits();

    // Bob deletes his reply in group thread
    const delRes = await request(app)
      .delete(`/api/v1/groups/${testGroupId}/messages/${groupReplyId}`)
      .set("Cookie", bob.cookies);
    assert.equal(delRes.status, 200);

    // Verify parent threadReplyCount decremented back to 0
    const threadCheck = await request(app)
      .get(`/api/v1/groups/${testGroupId}/messages/${groupParentId}/thread`)
      .set("Cookie", alice.cookies);
    assert.equal(threadCheck.status, 200);
    assert.equal(threadCheck.body?.data?.totalReplies, 0);
  });

  await teardownTestEnvironment(env);
});
