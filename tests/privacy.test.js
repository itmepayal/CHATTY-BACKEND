import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers, TEST_PASSWORD } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import Contact from "../src/modules/contacts/models/contact.model.js";
import Group from "../src/modules/groups/models/group.model.js";
import Message from "../src/modules/messaging/models/message.model.js";
import * as privacyService from "../src/modules/privacy/services/privacy.service.js";
import * as messageQueryService from "../src/modules/messaging/services/querying/message-query.service.js";
import * as messageDeliveryService from "../src/modules/messaging/services/delivery/message-delivery.service.js";
import { getAuthorizedOnlineUsersForViewer, onlineUsers } from "../src/infrastructure/socket/socket.js";

async function runTests() {
  console.log("==================================================");
  console.log("STARTING COMPREHENSIVE PRIVACY SETTINGS AUDIT TEST");
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
    const { alice, bob, charlie } = sessions;
    const aliceCookies = alice.cookies;
    const bobCookies = bob.cookies;

    const aliceUser = await User.findOne({ email: "alice@test.com" });
    const bobUser = await User.findOne({ email: "bob@test.com" });
    const charlieUser = await User.findOne({ email: "charlie@test.com" });

    const aliceId = String(aliceUser._id);
    const bobId = String(bobUser._id);
    const charlieId = String(charlieUser._id);

    // Setup contacts: Alice adds Bob as contact, Bob does NOT add Alice
    await Contact.deleteMany({});
    await Contact.create({
      ownerId: aliceId,
      contactId: bobId,
      name: "Bob by Alice",
    });

    /* ================================================================ */
    /* 1. REST API: GET & PATCH /api/v1/users/privacy                   */
    /* ================================================================ */

    await testCase("1.1 GET /api/v1/users/privacy returns defaults", async () => {
      const res = await request(env.app)
        .get("/api/v1/users/privacy")
        .set("Cookie", aliceCookies);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      const data = res.body.data;
      assert.equal(data.showOnlineStatus, true);
      assert.equal(data.readReceipts, true);
      assert.equal(data.typingIndicator, true);
      assert.equal(data.lastSeenVisibility, "contacts");
      assert.equal(data.onlineStatusVisibility, "everyone");
      assert.equal(data.profilePhotoVisibility, "everyone");
      assert.equal(data.aboutVisibility, "contacts");
      assert.equal(data.groupAddPermission, "contacts");
    });

    await testCase("1.2 PATCH /api/v1/users/privacy updates visibility settings", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({
          lastSeenVisibility: "nobody",
          onlineStatusVisibility: "nobody",
          profilePhotoVisibility: "contacts",
          aboutVisibility: "nobody",
          groupAddPermission: "nobody",
        });

      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      const data = res.body.data;
      assert.equal(data.lastSeenVisibility, "nobody");
      assert.equal(data.onlineStatusVisibility, "nobody");
      assert.equal(data.showOnlineStatus, false); // auto synced
      assert.equal(data.profilePhotoVisibility, "contacts");
      assert.equal(data.aboutVisibility, "nobody");
      assert.equal(data.groupAddPermission, "nobody");
    });

    await testCase("1.3 PATCH /api/v1/users/privacy updates boolean settings", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({
          readReceipts: false,
          typingIndicator: false,
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.readReceipts, false);
      assert.equal(res.body.data.typingIndicator, false);
    });

    await testCase("1.4 PATCH with alias whoCanAddMeToGroups updates groupAddPermission", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ whoCanAddMeToGroups: "everyone" });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.groupAddPermission, "everyone");
    });

    await testCase("1.5 PATCH rejects unknown fields with 400", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ invalidKey: true });

      assert.equal(res.status, 400);
      assert.match(res.body.message, /Unknown field/);
    });

    await testCase("1.6 PATCH rejects invalid visibility enum value with 400", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lastSeenVisibility: "invalid_option" });

      assert.equal(res.status, 400);
    });

    /* ================================================================ */
    /* 2. SETTING 1: LAST SEEN VISIBILITY                               */
    /* ================================================================ */

    await testCase("2.1 Last Seen 'nobody' hides timestamp from other users", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lastSeenVisibility: "nobody" });

      const canBobSee = await privacyService.canViewLastSeen(bobId, aliceId);
      assert.equal(canBobSee, false);

      const profile = await privacyService.getFilteredUserProfile(bobId, aliceId);
      assert.equal(profile.lastSeen, null);
    });

    await testCase("2.2 Last Seen 'everyone' reveals timestamp to all users", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lastSeenVisibility: "everyone" });

      const canBobSee = await privacyService.canViewLastSeen(bobId, aliceId);
      const canCharlieSee = await privacyService.canViewLastSeen(charlieId, aliceId);
      assert.equal(canBobSee, true);
      assert.equal(canCharlieSee, true);
    });

    await testCase("2.3 Last Seen 'contacts' reveals only to users in contacts list", async () => {
      // Alice has Bob in contacts, but not Charlie
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ lastSeenVisibility: "contacts" });

      const canBobSee = await privacyService.canViewLastSeen(bobId, aliceId);
      const canCharlieSee = await privacyService.canViewLastSeen(charlieId, aliceId);
      assert.equal(canBobSee, true);
      assert.equal(canCharlieSee, false);
    });

    /* ================================================================ */
    /* 3. SETTING 2: ONLINE STATUS VISIBILITY                           */
    /* ================================================================ */

    await testCase("3.1 Online Status 'nobody' hides presence from other users", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ onlineStatusVisibility: "nobody" });

      const canBobSee = await privacyService.canViewOnlineStatus(bobId, aliceId);
      assert.equal(canBobSee, false);

      // Verify authorized online list for Bob does not contain Alice
      onlineUsers.set(aliceId, new Set(["fake-socket-alice"]));
      onlineUsers.set(bobId, new Set(["fake-socket-bob"]));

      const bobOnlineList = await getAuthorizedOnlineUsersForViewer(bobId);
      assert.equal(bobOnlineList.includes(aliceId), false);
    });

    await testCase("3.2 Online Status 'everyone' reveals presence to all users", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ onlineStatusVisibility: "everyone" });

      const canBobSee = await privacyService.canViewOnlineStatus(bobId, aliceId);
      assert.equal(canBobSee, true);

      const bobOnlineList = await getAuthorizedOnlineUsersForViewer(bobId);
      assert.equal(bobOnlineList.includes(aliceId), true);
    });

    await testCase("3.3 Online Status 'contacts' reveals presence only to saved contacts", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ onlineStatusVisibility: "contacts" });

      const canBobSee = await privacyService.canViewOnlineStatus(bobId, aliceId);
      const canCharlieSee = await privacyService.canViewOnlineStatus(charlieId, aliceId);
      assert.equal(canBobSee, true);
      assert.equal(canCharlieSee, false);

      const charlieOnlineList = await getAuthorizedOnlineUsersForViewer(charlieId);
      assert.equal(charlieOnlineList.includes(aliceId), false);
    });

    /* ================================================================ */
    /* 4. SETTING 3: PROFILE PHOTO VISIBILITY                           */
    /* ================================================================ */

    await testCase("4.1 Profile Photo 'nobody' strips avatar in profile API", async () => {
      await User.findByIdAndUpdate(aliceId, {
        avatar: { url: "https://example.com/alice.jpg", public_id: "alice" },
      });

      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ profilePhotoVisibility: "nobody" });

      const profile = await privacyService.getFilteredUserProfile(bobId, aliceId);
      assert.equal(profile.avatar, null);
    });

    await testCase("4.2 Profile Photo 'everyone' includes avatar url for all", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ profilePhotoVisibility: "everyone" });

      const profile = await privacyService.getFilteredUserProfile(bobId, aliceId);
      assert.equal(profile.avatar, "https://example.com/alice.jpg");
    });

    await testCase("4.3 Profile Photo 'contacts' includes avatar only for contacts", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ profilePhotoVisibility: "contacts" });

      const bobView = await privacyService.getFilteredUserProfile(bobId, aliceId);
      const charlieView = await privacyService.getFilteredUserProfile(charlieId, aliceId);
      assert.equal(bobView.avatar, "https://example.com/alice.jpg");
      assert.equal(charlieView.avatar, null);
    });

    /* ================================================================ */
    /* 5. SETTING 4: ABOUT BIO & STATUS VISIBILITY                      */
    /* ================================================================ */

    await testCase("5.1 About Bio 'nobody' hides bio from other users", async () => {
      await User.findByIdAndUpdate(aliceId, { bio: "Software Engineer at Chatty" });

      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ aboutVisibility: "nobody" });

      const profile = await privacyService.getFilteredUserProfile(bobId, aliceId);
      assert.equal(profile.bio, "");
    });

    await testCase("5.2 About Bio 'everyone' shows bio to all users", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ aboutVisibility: "everyone" });

      const profile = await privacyService.getFilteredUserProfile(bobId, aliceId);
      assert.equal(profile.bio, "Software Engineer at Chatty");
    });

    await testCase("5.3 About Bio 'contacts' shows bio only to contacts", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ aboutVisibility: "contacts" });

      const bobView = await privacyService.getFilteredUserProfile(bobId, aliceId);
      const charlieView = await privacyService.getFilteredUserProfile(charlieId, aliceId);
      assert.equal(bobView.bio, "Software Engineer at Chatty");
      assert.equal(charlieView.bio, "");
    });

    /* ================================================================ */
    /* 6. SETTING 5: WHO CAN ADD ME TO GROUPS                           */
    /* ================================================================ */

    await testCase("6.1 Group Add 'nobody' blocks direct group additions with 403", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ groupAddPermission: "nobody" });

      // Bob tries to add Alice
      let thrown = null;
      try {
        await privacyService.assertCanAddToGroup(bobId, [aliceId]);
      } catch (err) {
        thrown = err;
      }
      assert.ok(thrown, "Expected assertCanAddToGroup to throw");
      assert.equal(thrown.statusCode, 403);
      assert.equal(thrown.code, "GROUP_ADD_PERMISSION_DENIED");

      // Verify POST /api/v1/groups creation with Alice returns 403
      const res = await request(env.app)
        .post("/api/v1/groups")
        .set("Cookie", bobCookies)
        .send({
          name: "Test Group",
          memberIds: [aliceId],
        });

      assert.equal(res.status, 403);
      assert.equal(res.body.code, "GROUP_ADD_PERMISSION_DENIED");
    });

    await testCase("6.2 Group Add 'contacts' allows contacts and blocks non-contacts", async () => {
      // Alice has Bob in contacts, but NOT Charlie
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ groupAddPermission: "contacts" });

      // Bob tries to add Alice (Alice has Bob saved -> allowed)
      await privacyService.assertCanAddToGroup(bobId, [aliceId]);

      // Charlie tries to add Alice (Alice does not have Charlie -> denied)
      let thrown = null;
      try {
        await privacyService.assertCanAddToGroup(charlieId, [aliceId]);
      } catch (err) {
        thrown = err;
      }
      assert.ok(thrown);
      assert.equal(thrown.statusCode, 403);
      assert.equal(thrown.code, "GROUP_ADD_PERMISSION_DENIED");
    });

    await testCase("6.3 Group Add 'everyone' allows any eligible user", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ groupAddPermission: "everyone" });

      await privacyService.assertCanAddToGroup(charlieId, [aliceId]);
    });

    /* ================================================================ */
    /* 7. SETTING 6: READ RECEIPTS (RECIPROCAL ENFORCEMENT)            */
    /* ================================================================ */

    await testCase("7.1 Read Receipts ON for both: canSendReadReceipt is true", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ readReceipts: true });
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bobCookies)
        .send({ readReceipts: true });

      const can = await privacyService.canSendReadReceipt(aliceId, bobId);
      assert.equal(can, true);
    });

    await testCase("7.2 Read Receipts OFF for Alice: reciprocal check fails", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ readReceipts: false });

      const can = await privacyService.canSendReadReceipt(aliceId, bobId);
      assert.equal(can, false);
    });

    await testCase("7.3 Existing 'seen' message status is masked to 'delivered' when receipts OFF", async () => {
      // Create a message between Alice and Bob with status 'seen'
      await Message.deleteMany({});
      const msg = await Message.create({
        senderId: aliceId,
        receiverId: bobId,
        text: "Hello Bob",
        status: "seen",
        seenAt: new Date(),
      });

      // Alice has readReceipts: false
      const result = await messageQueryService.getMessages(aliceId, bobId);
      assert.equal(result.messages.length, 1);
      assert.equal(result.messages[0].status, "delivered");
      assert.equal(result.messages[0].seenAt, null);

      // Re-enable read receipts
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ readReceipts: true });

      const resultAfter = await messageQueryService.getMessages(aliceId, bobId);
      assert.equal(resultAfter.messages[0].status, "seen");
      assert.ok(resultAfter.messages[0].seenAt);
    });

    await testCase("7.4 markMessagesSeen resets unreadCount without 'seen' status when receipts OFF", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", bobCookies)
        .send({ readReceipts: false });

      await Message.deleteMany({});
      await Message.create({
        senderId: aliceId,
        receiverId: bobId,
        text: "New unseen message",
        status: "sent",
        receiverReadAt: null,
      });

      const markRes = await messageDeliveryService.markMessagesSeen(bobId, aliceId);
      assert.equal(markRes.unreadCount, 0);

      // Verify DB record: receiverReadAt is set, but status is NOT seen
      const stored = await Message.findOne({ senderId: aliceId, receiverId: bobId });
      assert.ok(stored.receiverReadAt);
      assert.notEqual(stored.status, "seen");
    });

    /* ================================================================ */
    /* 8. SETTING 7: TYPING INDICATOR                                   */
    /* ================================================================ */

    await testCase("8.1 Typing Indicator ON: canSendTypingIndicator is true", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ typingIndicator: true });

      const can = await privacyService.canSendTypingIndicator(aliceId, bobId);
      assert.equal(can, true);
    });

    await testCase("8.2 Typing Indicator OFF: canSendTypingIndicator is false", async () => {
      await request(env.app)
        .patch("/api/v1/users/privacy")
        .set("Cookie", aliceCookies)
        .send({ typingIndicator: false });

      const can = await privacyService.canSendTypingIndicator(aliceId, bobId);
      assert.equal(can, false);
    });

    console.log("==================================================");
    console.log(`PRIVACY TEST SUITE FINISHED: Passed: ${passed} | Failed: ${failed}`);
    console.log("==================================================");

    assert.equal(failed, 0, `Failed tests detected: ${failed}`);
  } finally {
    await teardownTestEnvironment(env);
  }
}

runTests().catch((e) => {
  console.error("Test runner failed:", e);
  process.exit(1);
});
