import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import { computeNextOccurrence } from "../src/modules/messaging/jobs/scheduler.js";
import { sendMessageLimiter, settingsLimiter, reactLimiter } from "../src/middlewares/rateLimit/index.js";

async function resetLimiters(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(Boolean);
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await settingsLimiter.resetKey(k);
      await reactLimiter.resetKey(k);
    } catch {}
  }
}

test("Advanced 6 Messaging Features Verification Suite", async (t) => {
  const env = await setupTestEnvironment();
  const { app, port, io } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);

  const resetLimits = async () => {
    await resetLimiters(aliceId, bobId, charlieId);
  };

  let testGroupId;
  {
    const res = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({
        name: "Feature Test Group",
        memberIds: JSON.stringify([bobId, charlieId]),
      });
    assert.equal(res.status, 201);
    testGroupId = res.body?.data?.id || res.body?.data?._id;
  }

  // Send a direct message and a group message for testing
  let directMessageId;
  let groupMessageId;
  {
    const res = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .field("text", "Direct Hello for Advanced Features");
    assert.equal(res.status, 201);
    directMessageId = res.body?.data?.id || res.body?.data?._id || res.body?._id || res.body?.id;
  }
  {
    const res = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "Group Hello for Advanced Features");
    assert.equal(res.status, 201);
    groupMessageId = res.body?.data?.id || res.body?.data?._id;
  }

  // ==========================================
  // 1. ADVANCED REACTIONS
  // ==========================================
  await t.test("1. Advanced Reactions: Direct & Group", async () => {
    await resetLimits();

    // 1.1 Bob reacts to Alice's direct message
    const res1 = await request(app)
      .post(`/api/v1/messages/${directMessageId}/reactions`)
      .set("Cookie", bob.cookies)
      .send({ emoji: "❤️" });
    assert.equal(res1.status, 200);
    assert.equal(res1.body.data.action, "added");
    assert.equal(res1.body.data.reactionSummary.total, 1);

    // 1.2 Get reaction details for direct message
    const res2 = await request(app)
      .get(`/api/v1/messages/${directMessageId}/reactions`)
      .set("Cookie", alice.cookies);
    assert.equal(res2.status, 200);
    assert.equal(res2.body.data.reactionSummary.total, 1);
    assert.equal(res2.body.data.reactionSummary.summary[0].emoji, "❤️");

    // 1.3 Bob reacts to group message
    const res3 = await request(app)
      .post(
        `/api/v1/groups/${testGroupId}/messages/${groupMessageId}/reactions`,
      )
      .set("Cookie", bob.cookies)
      .send({ emoji: "🔥" });
    assert.equal(res3.status, 200);
    assert.equal(res3.body.data.action, "added");

    // 1.4 Charlie also reacts to group message
    const res4 = await request(app)
      .post(
        `/api/v1/groups/${testGroupId}/messages/${groupMessageId}/reactions`,
      )
      .set("Cookie", charlie.cookies)
      .send({ emoji: "🔥" });
    assert.equal(res4.status, 200);
    assert.equal(res4.body.data.reactionSummary.total, 2);

    // 1.5 Bob removes reaction by toggling same emoji
    const res5 = await request(app)
      .post(
        `/api/v1/groups/${testGroupId}/messages/${groupMessageId}/reactions`,
      )
      .set("Cookie", bob.cookies)
      .send({ emoji: "🔥" });
    assert.equal(res5.status, 200);
    assert.equal(res5.body.data.action, "removed");
    assert.equal(res5.body.data.reactionSummary.total, 1);
  });

  // ==========================================
  // 2. MESSAGE THREADS
  // ==========================================
  await t.test("2. Message Threads: Direct & Group", async () => {
    await resetLimits();

    // 2.1 Bob replies in thread to direct message
    const res1 = await request(app)
      .post(`/api/v1/messages/${directMessageId}/thread`)
      .set("Cookie", bob.cookies)
      .send({ text: "Thread reply 1 from Bob" });
    assert.equal(res1.status, 201);
    assert.equal(res1.body.data.parentMessage.threadReplyCount, 1);

    // 2.2 Alice replies in the same thread
    const res2 = await request(app)
      .post(`/api/v1/messages/${directMessageId}/thread`)
      .set("Cookie", alice.cookies)
      .send({ text: "Thread reply 2 from Alice" });
    assert.equal(res2.status, 201);
    assert.equal(res2.body.data.parentMessage.threadReplyCount, 2);

    // 2.3 Fetch thread
    const res3 = await request(app)
      .get(`/api/v1/messages/${directMessageId}/thread`)
      .set("Cookie", alice.cookies);
    assert.equal(res3.status, 200);
    assert.equal(res3.body.data.totalReplies, 2);
    assert.equal(res3.body.data.replies.length, 2);

    // 2.4 Charlie replies in thread to group message
    const res4 = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages/${groupMessageId}/thread`)
      .set("Cookie", charlie.cookies)
      .send({ text: "Group thread reply from Charlie" });
    assert.equal(res4.status, 201);
    assert.equal(res4.body.data.parentMessage.threadReplyCount, 1);

    // 2.5 Fetch group thread
    const res5 = await request(app)
      .get(`/api/v1/groups/${testGroupId}/messages/${groupMessageId}/thread`)
      .set("Cookie", bob.cookies);
    assert.equal(res5.status, 200);
    assert.equal(res5.body.data.totalReplies, 1);
  });

  // ==========================================
  // 3. ADVANCED MESSAGE SCHEDULING
  // ==========================================
  await t.test("3. Advanced Scheduling & Recurrence Engine", async () => {
    // 3.1 computeNextOccurrence for daily
    const baseDate = new Date("2026-11-20T10:00:00.000Z");
    const dailyRec = computeNextOccurrence(baseDate, {
      type: "daily",
      interval: 1,
      maxOccurrences: 5,
      currentOccurrence: 1,
    });
    assert.ok(dailyRec);
    assert.equal(dailyRec.currentOccurrence, 2);
    assert.equal(dailyRec.nextDate.toISOString(), "2026-11-21T10:00:00.000Z");

    // 3.2 computeNextOccurrence stops at maxOccurrences
    const maxRec = computeNextOccurrence(baseDate, {
      type: "daily",
      interval: 1,
      maxOccurrences: 2,
      currentOccurrence: 2,
    });
    assert.equal(maxRec, null);

    // 3.3 computeNextOccurrence for weekly
    const weeklyRec = computeNextOccurrence(baseDate, {
      type: "weekly",
      interval: 2,
    });
    assert.ok(weeklyRec);
    assert.equal(weeklyRec.nextDate.toISOString(), "2026-12-04T10:00:00.000Z");
  });

  // ==========================================
  // 4. POLLS AND VOTING
  // ==========================================
  await t.test("4. Polls & Live Voting", async () => {
    await resetLimits();

    // 4.1 Create group poll
    const res1 = await request(app)
      .post(`/api/v1/groups/${testGroupId}/polls`)
      .set("Cookie", alice.cookies)
      .send({
        question: "Where should we have dinner?",
        options: ["Italian", "Mexican", "Sushi"],
        isAnonymous: false,
        allowMultipleAnswers: false,
      });
    assert.equal(res1.status, 201);
    assert.ok(res1.body.data.poll);
    assert.equal(res1.body.data.poll.options.length, 3);
    const pollMessageId = res1.body.data.message.id;
    const italianOptionId = res1.body.data.poll.options[0]._id;
    const sushiOptionId = res1.body.data.poll.options[2]._id;

    // 4.2 Bob votes for Italian
    const res2 = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages/${pollMessageId}/poll/vote`)
      .set("Cookie", bob.cookies)
      .send({ optionIds: [italianOptionId] });
    assert.equal(res2.status, 200);
    assert.equal(res2.body.data.poll.totalVotes, 1);
    assert.equal(res2.body.data.poll.options[0].voteCount, 1);
    assert.equal(res2.body.data.poll.options[0].percentage, 100);

    // 4.3 Charlie votes for Sushi
    const res3 = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages/${pollMessageId}/poll/vote`)
      .set("Cookie", charlie.cookies)
      .send({ optionIds: [sushiOptionId] });
    assert.equal(res3.status, 200);
    assert.equal(res3.body.data.poll.totalVotes, 2);
    assert.equal(res3.body.data.poll.options[0].percentage, 50);
    assert.equal(res3.body.data.poll.options[2].percentage, 50);

    // 4.4 Get poll details with voters
    const res4 = await request(app)
      .get(`/api/v1/groups/${testGroupId}/messages/${pollMessageId}/poll`)
      .set("Cookie", alice.cookies);
    assert.equal(res4.status, 200);
    assert.equal(res4.body.data.poll.options[0].voters.length, 1);
    assert.equal(res4.body.data.poll.options[0].voters[0].id, bobId);

    // 4.5 Alice closes poll
    const res5 = await request(app)
      .post(
        `/api/v1/groups/${testGroupId}/messages/${pollMessageId}/poll/close`,
      )
      .set("Cookie", alice.cookies);
    assert.equal(res5.status, 200);
    assert.equal(res5.body.data.poll.isClosed, true);
  });

  // ==========================================
  // 5. SMART SAVED MESSAGES
  // ==========================================
  await t.test("5. Smart Saved Messages & Notes", async () => {
    // 5.1 Save direct message with category, tags, and personal note
    const res1 = await request(app)
      .post("/api/v1/saved-messages")
      .set("Cookie", alice.cookies)
      .send({
        messageId: directMessageId,
        messageModel: "Message",
        category: "Work",
        folder: "Projects",
        tags: ["urgent", "client"],
        note: "Follow up tomorrow morning",
      });
    assert.equal(res1.status, 201);
    const savedId = res1.body.data._id;

    // 5.2 Create a personal note
    const res2 = await request(app)
      .post("/api/v1/saved-messages/notes")
      .set("Cookie", alice.cookies)
      .send({
        note: "Remember to renew AWS certificate next week",
        category: "Reminders",
        folder: "DevOps",
        tags: ["infrastructure"],
      });
    assert.equal(res2.status, 201);

    // 5.3 Fetch saved messages with category filter
    const res3 = await request(app)
      .get("/api/v1/saved-messages?category=Work")
      .set("Cookie", alice.cookies);
    assert.equal(res3.status, 200);
    assert.equal(res3.body.data.total, 1);
    assert.equal(res3.body.data.items[0].note, "Follow up tomorrow morning");

    // 5.4 Fetch saved metadata (categories, folders, tags)
    const res4 = await request(app)
      .get("/api/v1/saved-messages/meta")
      .set("Cookie", alice.cookies);
    assert.equal(res4.status, 200);
    assert.ok(Array.isArray(res4.body.data.categories));
    assert.ok(res4.body.data.folders.includes("Projects"));

    // 5.5 Update saved message pin status
    const res5 = await request(app)
      .patch(`/api/v1/saved-messages/${savedId}`)
      .set("Cookie", alice.cookies)
      .send({ isPinned: true });
    assert.equal(res5.status, 200);
    assert.equal(res5.body.data.isPinned, true);

    // 5.6 Unsave message
    const res6 = await request(app)
      .delete(`/api/v1/saved-messages/${savedId}`)
      .set("Cookie", alice.cookies);
    assert.equal(res6.status, 200);
    assert.equal(res6.body.success, true);
  });

  // ==========================================
  // 6. DISAPPEARING MESSAGES & VIEW-ONCE
  // ==========================================
  await t.test("6. Disappearing Messages & View-Once Media", async () => {
    // 6.1 Admin sets group disappearing timer
    const res1 = await request(app)
      .patch(`/api/v1/groups/${testGroupId}/disappearing`)
      .set("Cookie", alice.cookies)
      .send({ seconds: 86400 });
    assert.equal(res1.status, 200);
    assert.equal(res1.body.data.disappearAfter, 86400);

    // 6.2 Non-admin cannot change group disappearing timer
    const res2 = await request(app)
      .patch(`/api/v1/groups/${testGroupId}/disappearing`)
      .set("Cookie", charlie.cookies)
      .send({ seconds: 3600 });
    assert.equal(res2.status, 403);

    // 6.3 Send a view-once direct message
    const msgRes = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .field("text", "Secret View-Once Image")
      .field("isViewOnce", "true");
    assert.equal(msgRes.status, 201);
    const viewOnceId = msgRes.body?.data?.id || msgRes.body?.data?._id || msgRes.body?._id || msgRes.body?.id;

    // 6.4 Bob opens the view-once message
    const openRes = await request(app)
      .post(`/api/v1/messages/${viewOnceId}/view-once/open`)
      .set("Cookie", bob.cookies);
    assert.equal(openRes.status, 200);
    assert.equal(openRes.body.data.viewOnceExpired, true);

    // 6.5 Attempting to open already expired view-once rejects with 400 or 404 (purged)
    const reOpenRes = await request(app)
      .post(`/api/v1/messages/${viewOnceId}/view-once/open`)
      .set("Cookie", bob.cookies);
    assert.ok(reOpenRes.status === 400 || reOpenRes.status === 404);
  });

  await teardownTestEnvironment();
});
