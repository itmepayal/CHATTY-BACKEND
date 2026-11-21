import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import { sendMessageLimiter } from "../src/middlewares/rateLimit/index.js";
import Notification from "../src/modules/notifications/models/notification.model.js";

async function resetLimiters(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(Boolean);
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
    } catch {}
  }
}

async function waitFor(fn, timeoutMs = 3000, intervalMs = 50) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fn();
    if (res) return res;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return await fn();
}

test("Complete @all Group Mention System Verification Suite", async (t) => {
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

  let testGroupId;
  // Alice creates group with Bob and Charlie
  {
    const res = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({
        name: "Dev Team All",
        memberIds: JSON.stringify([bobId, charlieId]),
      });
    assert.equal(res.status, 201);
    testGroupId = res.body?.data?.id || res.body?.data?._id;
  }

  await t.test("1. Send message with @all by group member (everyone permission)", async () => {
    await resetLimits();

    const res = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "@all Important team standup meeting in 5 minutes!");

    assert.equal(res.status, 201);
    assert.ok(res.body?.data);
    assert.equal(res.body.data.mentionAll, true);

    const mentionedUserIds = (res.body.data.mentions || []).map((m) =>
      String(m.userId?._id || m.userId),
    );
    // Bob and Charlie should be in mentions, Alice (sender) should NOT
    assert.ok(mentionedUserIds.includes(bobId));
    assert.ok(mentionedUserIds.includes(charlieId));
    assert.ok(!mentionedUserIds.includes(aliceId));

    // Verify notifications were created for Bob and Charlie
    const notifs = await waitFor(async () => {
      const docs = await Notification.find({
        "data.groupId": testGroupId,
        senderId: alice.user._id,
        type: "group_mention_all",
      }).lean();
      return docs && docs.length === 2 ? docs : null;
    });

    assert.ok(notifs, "Expected 2 notifications to be created");
    assert.equal(notifs.length, 2);
    const recipientIds = notifs.map((n) => String(n.recipientId));
    assert.ok(recipientIds.includes(bobId));
    assert.ok(recipientIds.includes(charlieId));
    assert.equal(notifs[0].data?.mentionType, "all");
    assert.ok(notifs[0].body.includes("mentioned everyone in Dev Team All"));
  });

  await t.test("2. Exact token matching: @allusers or emails do NOT trigger mentionAll", async () => {
    await resetLimits();

    // Message containing @allusers
    const res1 = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", bob.cookies)
      .field("text", "Check out @allusers for more details");

    assert.equal(res1.status, 201);
    assert.equal(res1.body.data.mentionAll, false);

    // Message containing email address user@all.com
    const res2 = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", bob.cookies)
      .field("text", "Contact us at contact@all.com");

    assert.equal(res2.status, 201);
    assert.equal(res2.body.data.mentionAll, false);
  });

  await t.test("3. Permission: admins_only prevents non-admin from using @all", async () => {
    await resetLimits();

    // Alice (owner/admin) sets mentionAllPermission to admins_only
    const updateRes = await request(app)
      .patch(`/api/v1/groups/${testGroupId}`)
      .set("Cookie", alice.cookies)
      .field("mentionAllPermission", "admins_only");

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.mentionAllPermission, "admins_only");

    // Bob (regular member) attempts to send @all -> Should be 403 Forbidden
    const bobRes = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", bob.cookies)
      .field("text", "@all Bob trying to mention everyone without admin rights");

    assert.equal(bobRes.status, 403);
    assert.ok(
      bobRes.body?.message?.includes("Only group admins can mention everyone"),
    );

    // Alice (admin/owner) sends @all -> Should succeed
    const aliceRes = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "@all Admin announcement from Alice");

    assert.equal(aliceRes.status, 201);
    assert.equal(aliceRes.body.data.mentionAll, true);
  });

  await t.test("4. Permission: disabled prevents everyone from using @all", async () => {
    await resetLimits();

    // Alice sets mentionAllPermission to disabled
    const updateRes = await request(app)
      .patch(`/api/v1/groups/${testGroupId}`)
      .set("Cookie", alice.cookies)
      .field("mentionAllPermission", "disabled");

    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.data.mentionAllPermission, "disabled");

    // Alice herself tries to send @all -> Should be 403 Forbidden
    const aliceRes = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "@all Trying to mention when disabled");

    assert.equal(aliceRes.status, 403);
    assert.ok(
      aliceRes.body?.message?.includes("Mentioning everyone is disabled in this group"),
    );
  });

  await t.test("5. Coexistence: @all and individual member mentions", async () => {
    await resetLimits();

    // Re-enable everyone permission
    await request(app)
      .patch(`/api/v1/groups/${testGroupId}`)
      .set("Cookie", alice.cookies)
      .field("mentionAllPermission", "everyone");

    // Send message with @all and explicit mention of Bob
    const res = await request(app)
      .post(`/api/v1/groups/${testGroupId}/messages`)
      .set("Cookie", alice.cookies)
      .field("text", "@all please welcome @Bob to the team!")
      .field(
        "mentions",
        JSON.stringify([{ userId: bobId, startIndex: 22, length: 4 }]),
      );

    assert.equal(res.status, 201);
    assert.equal(res.body.data.mentionAll, true);

    const mentionedUserIds = (res.body.data.mentions || []).map((m) =>
      String(m.userId?._id || m.userId),
    );
    // Bob should not be duplicated, both Bob and Charlie are present
    const bobMentions = mentionedUserIds.filter((id) => id === bobId);
    assert.equal(bobMentions.length, 1);
    assert.ok(mentionedUserIds.includes(charlieId));
  });

  await teardownTestEnvironment();
});
