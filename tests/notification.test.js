import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import Notification, {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_TYPES,
} from "../src/modules/notifications/models/notification.model.js";
import * as notificationService from "../src/modules/notifications/services/notification.service.js";

async function runNotificationTests() {
  console.log("==================================================");
  console.log("STARTING CENTRALIZED NOTIFICATION ECOSYSTEM TESTS");
  console.log("==================================================");

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
    const { alice, bob } = sessions;

    const aliceUser = await User.findOne({ email: "alice@test.com" });
    const bobUser = await User.findOne({ email: "bob@test.com" });
    const aliceId = String(aliceUser._id);
    const bobId = String(bobUser._id);

    /* ================================================================ */
    /* 1. Dispatch & Category Mapping                                   */
    /* ================================================================ */

    await testCase("1.1 Dispatch personal message notification", async () => {
      const notif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Bob Smith",
        body: "Hello Alice!",
        data: { peerId: bobId, messageId: "msg_123" },
      });

      assert.ok(notif);
      assert.equal(notif.category, NOTIFICATION_CATEGORIES.MESSAGE);
      assert.equal(notif.type, NOTIFICATION_TYPES.MESSAGE_RECEIVED);
      assert.equal(notif.isRead, false);
    });

    await testCase("1.2 Dispatch group notification", async () => {
      const notif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.GROUP_MESSAGE_RECEIVED,
        title: "Project Alpha",
        body: "Bob: Let's meet at 5",
        data: { groupId: "grp_456" },
      });

      assert.ok(notif);
      assert.equal(notif.category, NOTIFICATION_CATEGORIES.GROUP);
      assert.equal(notif.type, NOTIFICATION_TYPES.GROUP_MESSAGE_RECEIVED);
    });

    await testCase("1.3 Dispatch security alert notification", async () => {
      const notif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        type: NOTIFICATION_TYPES.SECURITY_NEW_DEVICE,
        title: "New Device Login",
        body: "Logged in from Chrome on Linux",
        priority: "critical",
        data: { device: "Chrome" },
      });

      assert.ok(notif);
      assert.equal(notif.category, NOTIFICATION_CATEGORIES.SECURITY);
      assert.equal(notif.type, NOTIFICATION_TYPES.SECURITY_NEW_DEVICE);
    });

    await testCase("1.4 Self-notifications are rejected", async () => {
      const notif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: aliceId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Self",
        body: "Test self",
      });

      assert.equal(notif, null);
    });

    /* ================================================================ */
    /* 2. REST API & Filtering                                          */
    /* ================================================================ */

    await testCase("2.1 GET /api/v1/notifications retrieves all notifications for user", async () => {
      const res = await request(env.app)
        .get("/api/v1/notifications")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);
      assert.ok(res.body.data.items);
      assert.ok(res.body.data.items.length >= 3);
      assert.ok(res.body.data.unreadCount >= 3);
    });

    await testCase("2.2 GET /api/v1/notifications with category filter", async () => {
      const res = await request(env.app)
        .get("/api/v1/notifications?category=group")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);
      const items = res.body.data.items;
      assert.ok(items.length >= 1);
      assert.ok(items.every((n) => n.category === "group"));
    });

    await testCase("2.3 GET /api/v1/notifications/unread-count returns counts by category", async () => {
      const res = await request(env.app)
        .get("/api/v1/notifications/unread-count")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);
      assert.ok(res.body.data.count >= 3);
      assert.ok(res.body.data.categoryCounts);
      assert.ok(res.body.data.categoryCounts.message >= 1);
      assert.ok(res.body.data.categoryCounts.group >= 1);
      assert.ok(res.body.data.categoryCounts.security >= 1);
    });

    await testCase("2.4 PATCH /api/v1/notifications/:id/read marks single notification as read", async () => {
      const listRes = await request(env.app)
        .get("/api/v1/notifications?unreadOnly=true")
        .set("Cookie", alice.cookies);

      const targetId = listRes.body.data.items[0]._id;
      const readRes = await request(env.app)
        .patch(`/api/v1/notifications/${targetId}/read`)
        .set("Cookie", alice.cookies);

      assert.equal(readRes.status, 200);
      assert.equal(readRes.body.data.isRead, true);

      // Verify in DB
      const dbDoc = await Notification.findById(targetId);
      assert.equal(dbDoc.isRead, true);
    });

    await testCase("2.5 PATCH /api/v1/notifications/read-all marks all as read", async () => {
      const res = await request(env.app)
        .patch("/api/v1/notifications/read-all")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);

      const countRes = await request(env.app)
        .get("/api/v1/notifications/unread-count")
        .set("Cookie", alice.cookies);

      assert.equal(countRes.body.data.count, 0);
    });

    /* ================================================================ */
    /* 3. DND & Mute Rules                                              */
    /* ================================================================ */

    await testCase("3.1 DND mode suppresses non-critical notifications", async () => {
      // Enable DND for Alice
      await User.findByIdAndUpdate(aliceId, {
        "notificationPreferences.dndEnabled": true,
        "notificationPreferences.dndUntil": null,
      });

      const messageNotif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "DND Test",
        body: "Should be muted",
      });

      assert.equal(messageNotif, null); // Suppressed by DND
    });

    await testCase("3.2 Critical security notifications bypass DND", async () => {
      const securityNotif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        type: NOTIFICATION_TYPES.SECURITY_PASSWORD_CHANGED,
        title: "Critical Password Change",
        body: "Bypasses DND",
        priority: "critical",
      });

      assert.ok(securityNotif);
      assert.equal(securityNotif.type, NOTIFICATION_TYPES.SECURITY_PASSWORD_CHANGED);
    });

    await testCase("3.3 Muted conversation suppresses notifications for that sender", async () => {
      // Disable DND, but mute Bob for Alice
      await User.findByIdAndUpdate(aliceId, {
        "notificationPreferences.dndEnabled": false,
        "notificationPreferences.mutedConversations": [bobId],
      });

      const mutedNotif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Muted Bob",
        body: "Should not notify",
      });

      assert.equal(mutedNotif, null); // Suppressed by conversation mute
    });

    /* ================================================================ */
    /* 4. Clear & Delete                                                */
    /* ================================================================ */

    await testCase("4.1 DELETE /api/v1/notifications/:id deletes single notification", async () => {
      const notif = await Notification.findOne({ recipientId: aliceId });
      const res = await request(env.app)
        .delete(`/api/v1/notifications/${notif._id}`)
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);

      const exists = await Notification.findById(notif._id);
      assert.equal(exists, null);
    });

    await testCase("4.2 DELETE /api/v1/notifications/clear-all clears all notifications", async () => {
      const res = await request(env.app)
        .delete("/api/v1/notifications/clear-all")
        .set("Cookie", alice.cookies);

      assert.equal(res.status, 200);

      const remaining = await Notification.countDocuments({ recipientId: aliceId });
      assert.equal(remaining, 0);
    });

    /* ================================================================ */
    /* 5. Advanced Ecosystem: Master Switch, Unread, Story & Privacy    */
    /* ================================================================ */

    // Unmute Bob for Alice before section 5 tests
    await User.findByIdAndUpdate(aliceId, {
      "notificationPreferences.mutedConversations": [],
      "notificationPreferences.masterEnabled": true,
      "notificationPreferences.dndEnabled": false,
    });

    await testCase("5.1 PATCH /api/v1/notifications/:id/unread marks as unread", async () => {
      const notif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Unread Test Message",
        body: "Hello Alice",
      });

      // First mark as read
      await request(env.app)
        .patch(`/api/v1/notifications/${notif.id}/read`)
        .set("Cookie", alice.cookies);

      // Now mark as unread
      const unreadRes = await request(env.app)
        .patch(`/api/v1/notifications/${notif.id}/unread`)
        .set("Cookie", alice.cookies);

      assert.equal(unreadRes.status, 200);
      assert.equal(unreadRes.body.data.isRead, false);

      const dbDoc = await Notification.findById(notif.id);
      assert.equal(dbDoc.isRead, false);
    });

    await testCase("5.2 DELETE /api/v1/notifications/clear-read removes read only", async () => {
      // Create one read and one unread notification
      const readNotif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Read Notif",
        body: "To be cleared",
        dedupKey: `read_test_${Date.now()}_1`,
      });
      await request(env.app)
        .patch(`/api/v1/notifications/${readNotif.id}/read`)
        .set("Cookie", alice.cookies);

      const unreadNotif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Keep Unread Notif",
        body: "Must remain",
        dedupKey: `unread_test_${Date.now()}_2`,
      });

      const clearRes = await request(env.app)
        .delete("/api/v1/notifications/clear-read")
        .set("Cookie", alice.cookies);

      assert.equal(clearRes.status, 200);

      const readExists = await Notification.findById(readNotif.id);
      const unreadExists = await Notification.findById(unreadNotif.id);
      assert.equal(readExists, null);
      assert.notEqual(unreadExists, null);
    });

    await testCase("5.3 Master switch disabled suppresses non-critical notifications", async () => {
      await User.findByIdAndUpdate(aliceId, {
        "notificationPreferences.masterEnabled": false,
      });

      const suppressed = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Should Be Suppressed",
        body: "Master toggle is off",
      });

      assert.equal(suppressed, null);
    });

    await testCase("5.4 Critical security notifications bypass master switch", async () => {
      const securityNotif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        type: NOTIFICATION_TYPES.SECURITY_NEW_DEVICE,
        title: "Security: New Device Login",
        body: "Linux Firefox from 192.168.1.1",
      });

      assert.notEqual(securityNotif, null);
      assert.equal(securityNotif.category, "security");

      // Re-enable master switch for subsequent tests
      await User.findByIdAndUpdate(aliceId, {
        "notificationPreferences.masterEnabled": true,
      });
    });

    await testCase("5.5 Story reaction and favorite notifications dispatch properly", async () => {
      const storyReaction = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        category: NOTIFICATION_CATEGORIES.STORY,
        type: NOTIFICATION_TYPES.STORY_REACTION,
        title: "Story Reaction",
        body: "Bob reacted 🔥 to your story",
      });

      assert.notEqual(storyReaction, null);
      assert.equal(storyReaction.category, "story");
      assert.equal(storyReaction.type, "story_reaction");
    });

    await testCase("5.6 Notification preview privacy hides sensitive text when requested", async () => {
      // Set Alice's preview privacy to sender_only
      await User.findByIdAndUpdate(aliceId, {
        "notificationPreferences.previewPrivacy": "sender_only",
        "notificationSettings.previewPrivacy": "sender_only",
      });

      const notif = await notificationService.dispatchNotification({
        recipientId: aliceId,
        senderId: bobId,
        category: NOTIFICATION_CATEGORIES.MESSAGE,
        type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
        title: "Bob Smith",
        body: "Very confidential bank account number: 123456",
        dedupKey: `privacy_test_${Date.now()}`,
      });

      assert.equal(notif.body, "New message"); // Redacted from confidential content!

      // Reset
      await User.findByIdAndUpdate(aliceId, {
        "notificationPreferences.previewPrivacy": "full",
        "notificationSettings.previewPrivacy": "full",
      });
    });
  } catch (err) {
    console.error("Test setup error:", err);
  } finally {
    console.log("==================================================");
    console.log(`NOTIFICATION TESTS: Passed: ${passed} | Failed: ${failed}`);
    console.log("==================================================");
    process.exit(failed > 0 ? 1 : 0);
  }
}

runNotificationTests();
