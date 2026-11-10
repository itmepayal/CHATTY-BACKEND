import { test } from "node:test";
import assert from "node:assert/strict";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import repositories, {
  authRepository,
  sessionRepository,
  userRepository,
  userKeyRepository,
  userProfileRepository,
  userSettingsRepository,
  userRelationRepository,
  contactRepository,
  messageRepository,
  chatSettingRepository,
  scheduledMessageRepository,
  locationShareRepository,
  reportRepository,
  groupRepository,
  groupMessageRepository,
  groupKeyRepository,
  groupArchiveRepository,
  callRepository,
  groupCallRepository,
  privacyRepository,
} from "../src/modules/repositories.js";

test("Repository Architecture Comprehensive Suite", async () => {
  await setupTestEnvironment();

  try {
    console.log("\n==================================================");
    console.log("Starting Repository Layer Comprehensive Audit Suite");
    console.log("==================================================");

    // --- 1. User & Auth Repositories ---
    console.log("\n--- Domain 1: Auth & Users ---");
    const u1 = await authRepository.create({
      fullName: "Alice Repository",
      email: "alice.repo@test.com",
      password: "Password123!",
      username: "alicerepo",
    });
    assert.ok(u1._id, "User 1 created");

    const u2 = await userRepository.create({
      fullName: "Bob Repository",
      email: "bob.repo@test.com",
      password: "Password123!",
      username: "bobrepo",
    });
    assert.ok(u2._id, "User 2 created");

    const foundU1 = await authRepository.findByEmail("alice.repo@test.com");
    assert.equal(foundU1.email, "alice.repo@test.com");
    assert.equal(typeof foundU1.toObject, "undefined", "findByEmail returns lean object");

    const foundDocU1 = await authRepository.findDocumentByEmail("alice.repo@test.com");
    assert.equal(typeof foundDocU1.toObject, "function", "findDocumentByEmail returns mutable document");

    const u1Exists = await userRepository.existsById(u1._id);
    assert.equal(u1Exists, true);

    const usernameTaken = await userProfileRepository.existsUsernameExcept("alicerepo", u2._id);
    assert.equal(usernameTaken, true);

    const usernameSelf = await userProfileRepository.existsUsernameExcept("alicerepo", u1._id);
    assert.equal(usernameSelf, false);

    const updatedProfile = await userProfileRepository.updateProfileById(u1._id, {
      $set: { bio: "Senior Architect" },
    });
    assert.equal(updatedProfile.bio, "Senior Architect");

    // --- 2. User Settings & Relations ---
    console.log("\n--- Domain 2: User Settings, Relations & Keys ---");
    const priv = await userSettingsRepository.findPrivacySettings(u1._id);
    assert.ok(priv);

    const updatedPriv = await userSettingsRepository.updatePrivacySettings(u1._id, {
      $set: { profilePhotoVisibility: "contacts" },
    });
    assert.equal(updatedPriv.profilePhotoVisibility, "contacts");

    const testPublicKey = { kty: "EC", crv: "P-256", x: "test-x", y: "test-y" };
    await userKeyRepository.updateUserPublicKey(u1._id, testPublicKey);
    const hasKey = await userKeyRepository.existsByUserId(u1._id);
    assert.equal(hasKey, true);

    const fetchedKey = await userKeyRepository.findPublicKeyByUserId(u1._id);
    assert.equal(fetchedKey.publicKey.x, "test-x");

    // Block relationship
    await userRelationRepository.updateRelation(u1._id, {
      $addToSet: { blockedUsers: u2._id },
    });
    const isBlocked = await userRelationRepository.existsBlockedEitherWay(u1._id, u2._id);
    assert.equal(isBlocked, true);

    const blockers = await userRelationRepository.findBlockersOf([u1._id], u2._id);
    assert.equal(blockers.length, 1);

    // --- 3. Sessions Repository ---
    console.log("\n--- Domain 3: Sessions ---");
    const sessionDoc = await sessionRepository.create({
      userId: u1._id,
      device: { os: "Linux", browser: "Chrome" },
      ip: "127.0.0.1",
      expiresAt: new Date(Date.now() + 3600000),
    });
    assert.ok(sessionDoc._id);

    const activeSessions = await sessionRepository.findActiveSessionsForUser(u1._id);
    assert.equal(activeSessions.length, 1);

    await sessionRepository.touchSession(sessionDoc._id);
    await sessionRepository.revokeById(sessionDoc._id);
    const activeAfterRevoke = await sessionRepository.findActiveSessionsForUser(u1._id);
    assert.equal(activeAfterRevoke.length, 0);

    // --- 4. Contacts Repository ---
    console.log("\n--- Domain 4: Contacts ---");
    await contactRepository.upsertContact(u1._id, u2._id, "Bobby");
    const contactExists = await contactRepository.existsContact(u1._id, u2._id);
    assert.equal(contactExists, true);

    const contactIds = await contactRepository.findContactIds(u1._id);
    assert.ok(contactIds.includes(String(u2._id)));

    const contactIdSet = await contactRepository.findExistingContactIdSet(u1._id, [u2._id]);
    assert.equal(contactIdSet.has(String(u2._id)), true);

    const { rows: contactList, total: contactCount } = await contactRepository.findContactsAggregation(u1._id);
    assert.equal(contactCount, 1);
    assert.equal(contactList[0].nickname, "Bobby");

    // --- 5. Messaging Domain ---
    console.log("\n--- Domain 5: Messaging (Direct, Settings, Scheduled, Location, Reports) ---");
    const msg = await messageRepository.create({
      senderId: u1._id,
      receiverId: u2._id,
      text: "Hello from repository test!",
      status: "delivered",
    });
    assert.ok(msg._id);

    const msgCount = await messageRepository.countDocuments({ senderId: u1._id });
    assert.equal(msgCount, 1);

    const chatListMessages = await contactRepository.aggregateChatListMessages(u1._id, [String(u2._id)]);
    assert.ok(chatListMessages.has(String(u2._id)));

    // Chat settings & archive
    await chatSettingRepository.upsertDisappear(
      { pairKey: `${u1._id}_${u2._id}` },
      { disappearAfter: 3600 },
    );
    await chatSettingRepository.archiveChat(u1._id, u2._id);
    await chatSettingRepository.unarchiveChat(u1._id, u2._id);

    // Scheduled messages
    const sched = await scheduledMessageRepository.create({
      senderId: u1._id,
      receiverId: u2._id,
      text: "Scheduled note",
      scheduledFor: new Date(Date.now() + 100000),
      status: "pending",
    });
    assert.ok(sched._id);
    const sortedSched = await scheduledMessageRepository.findSorted({ senderId: u1._id });
    assert.equal(sortedSched.length, 1);

    // Location shares
    const loc = await locationShareRepository.create({
      sharerId: u1._id,
      receiverId: u2._id,
      location: { type: "Point", coordinates: [77.209, 28.6139] },
      expiresAt: new Date(Date.now() + 3600000),
      status: "active",
    });
    assert.ok(loc._id);

    // Reports
    const rep = await reportRepository.create({
      reporterId: u2._id,
      reportedUserId: u1._id,
      reason: "spam",
    });
    assert.ok(rep._id);
    const repExists = await reportRepository.exists({ reporterId: u2._id, reportedUserId: u1._id });
    assert.equal(repExists, true);

    // --- 6. Groups Domain ---
    console.log("\n--- Domain 6: Groups, Messages, Keys, Archives ---");
    const group = await groupRepository.create({
      name: "Architecture Working Group",
      owner: u1._id,
      members: [
        { userId: u1._id, role: "admin" },
        { userId: u2._id, role: "member" },
      ],
    });
    assert.ok(group._id);

    const loadedGroup = await groupRepository.loadWithMembers(group._id);
    assert.equal(loadedGroup.members.length, 2);

    const gMsg = await groupMessageRepository.create({
      groupId: group._id,
      senderId: u1._id,
      text: "Group message test",
    });
    assert.ok(gMsg._id);

    const gMsgCount = await groupMessageRepository.countDocuments({ groupId: group._id });
    assert.equal(gMsgCount, 1);

    await groupKeyRepository.bulkWriteKeys([
      {
        insertOne: {
          document: {
            groupId: group._id,
            userId: u1._id,
            version: 1,
            wrappedKey: "wrapped-key-1",
            iv: "iv-1",
            wrappedBy: u1._id,
          },
        },
      },
    ]);
    const latestVer = await groupKeyRepository.findLatestVersion(group._id);
    assert.equal(latestVer.version, 1);

    await groupArchiveRepository.upsert(u1._id, group._id);
    const gArchived = await groupArchiveRepository.exists({ ownerId: u1._id, groupId: group._id });
    assert.equal(gArchived, true);

    // --- 7. Calling Domain ---
    console.log("\n--- Domain 7: One-to-One and Group Calling ---");
    const call = await callRepository.create({
      callId: "call_test_123",
      callerId: u1._id,
      receiverId: u2._id,
      type: "audio",
      status: "completed",
      startedAt: new Date(),
    });
    assert.ok(call._id);

    const foundCall = await callRepository.findByCallId("call_test_123");
    assert.equal(foundCall.callId, "call_test_123");

    const groupCall = await groupCallRepository.create({
      callId: "group_call_test_456",
      groupId: group._id,
      startedBy: u1._id,
      type: "video",
      status: "completed",
      startedAt: new Date(),
    });
    assert.ok(groupCall._id);

    const foundGroupCall = await groupCallRepository.findByCallId("group_call_test_456");
    assert.equal(foundGroupCall.callId, "group_call_test_456");

    // --- 8. Privacy Domain ---
    console.log("\n--- Domain 8: Privacy Repository ---");
    const userPriv = await privacyRepository.findUserPrivacy(u1._id);
    assert.ok(userPriv);
    assert.equal(userPriv.profilePhotoVisibility, "contacts");

    // --- 9. Account Deletion Cascade Cleanup ---
    console.log("\n--- Domain 9: Cascade Cleanup Repositories ---");
    await contactRepository.deleteInvolvingUser(u2._id);
    const contactRemaining = await contactRepository.existsContact(u1._id, u2._id);
    assert.equal(contactRemaining, false);

    await callRepository.deleteForUser(u1._id);
    const callRemaining = await callRepository.findByCallId("call_test_123");
    assert.equal(callRemaining, null);

    console.log("\n==================================================");
    console.log("ALL REPOSITORY DOMAINS VERIFIED SUCCESSFULLY [✓]");
    console.log("==================================================");
  } finally {
    await teardownTestEnvironment();
  }
});
