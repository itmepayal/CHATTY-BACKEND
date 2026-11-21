import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import { sendMessageLimiter, reactLimiter } from "../src/middlewares/rateLimit/index.js";

async function resetLimiters(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(Boolean);
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await reactLimiter.resetKey(k);
    } catch {}
  }
}

test("Gift Messaging, Reply to Message & Reactions Verification Suite", async (t) => {
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

  await resetLimits();

  let directGiftMessageId;
  let groupGiftMessageId;
  let testGroupId;

  await t.test("1. Send Digital Gift in Direct Chat (1:1)", async () => {
    await resetLimits();

    const giftPayload = {
      id: "rose",
      name: "Red Rose",
      icon: "🌹",
      category: "Love",
      message: "Sending you love!",
    };

    const res = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .field("gift", JSON.stringify(giftPayload))
      .field("text", "Enjoy this rose!");

    assert.equal(res.status, 201);
    assert.ok(res.body?.data);
    assert.equal(res.body.data.messageType, "gift");
    assert.ok(res.body.data.gift);
    assert.equal(res.body.data.gift.name, "Red Rose");
    assert.equal(res.body.data.gift.icon, "🌹");
    assert.equal(res.body.data.gift.category, "Love");

    directGiftMessageId = res.body.data.id || res.body.data._id;
  });

  await t.test("2. Send Digital Gift in Group Chat", async () => {
    await resetLimits();

    // Create group
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({
        name: "Celebration Group",
        memberIds: JSON.stringify([bobId, charlieId]),
      });
    assert.equal(groupRes.status, 201);
    testGroupId = groupRes.body?.data?.id || groupRes.body?.data?._id;

    // Send gift in group
    const giftPayload = {
      id: "party_popper",
      name: "Party Popper",
      icon: "🎉",
      category: "Celebration",
      message: "Congratulations everyone!",
    };

    const res = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("gift", JSON.stringify(giftPayload))
      .field("text", "Let's party!");

    assert.equal(res.status, 201);
    assert.ok(res.body?.data);
    assert.equal(res.body.data.messageType, "gift");
    assert.ok(res.body.data.gift);
    assert.equal(res.body.data.gift.name, "Party Popper");
    assert.equal(res.body.data.gift.icon, "🎉");

    groupGiftMessageId = res.body.data.id || res.body.data._id;
  });

  await t.test("3. Reply to Gift Message (Direct and Group)", async () => {
    await resetLimits();

    // Bob replies to Alice's direct gift
    const replyRes = await request(app)
      .post(`/api/v1/messages/send/${aliceId}`)
      .set("Cookie", bob.cookies)
      .field("replyTo", directGiftMessageId)
      .field("text", "Thank you so much for the rose!");

    assert.equal(replyRes.status, 201);
    assert.ok(replyRes.body?.data?.replyTo);
    assert.equal(replyRes.body.data.replyTo.type, "gift");
    assert.equal(replyRes.body.data.replyTo.gift?.name, "Red Rose");

    // Charlie replies to Alice's group gift
    const groupReplyRes = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", charlie.cookies)
      .field("replyTo", groupGiftMessageId)
      .field("text", "Woohoo! Awesome gift!");

    assert.equal(groupReplyRes.status, 201);
    assert.ok(groupReplyRes.body?.data?.replyTo);
    assert.equal(groupReplyRes.body.data.replyTo.type, "gift");
    assert.equal(groupReplyRes.body.data.replyTo.gift?.name, "Party Popper");
  });

  await t.test("4. Add and Toggle Message Reactions", async () => {
    await resetLimits();

    // Bob reacts with ❤️ to direct gift message
    const react1 = await request(app)
      .post(`/api/v1/messages/${directGiftMessageId}/reactions`)
      .set("Cookie", bob.cookies)
      .send({ emoji: "❤️" });

    assert.equal(react1.status, 200);
    assert.ok(react1.body?.data?.reactions);
    assert.equal(react1.body.data.reactions.length, 1);
    assert.equal(react1.body.data.reactions[0].emoji, "❤️");
    assert.equal(react1.body.data.reactions[0].userId, bobId);

    // Alice also reacts with 🔥 to the same message
    const react2 = await request(app)
      .post(`/api/v1/messages/${directGiftMessageId}/reactions`)
      .set("Cookie", alice.cookies)
      .send({ emoji: "🔥" });

    assert.equal(react2.status, 200);
    assert.equal(react2.body.data.reactions.length, 2);

    // Bob clicks ❤️ again to toggle/remove his reaction
    const react3 = await request(app)
      .post(`/api/v1/messages/${directGiftMessageId}/reactions`)
      .set("Cookie", bob.cookies)
      .send({ emoji: "❤️" });

    assert.equal(react3.status, 200);
    assert.equal(react3.body.data.reactions.length, 1);
    assert.equal(react3.body.data.reactions[0].userId, aliceId);
  });

  t.after(async () => {
    await teardownTestEnvironment();
  });
});
