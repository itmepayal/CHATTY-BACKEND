import fs from "fs";
import path from "path";
import request from "supertest";
import mongoose from "mongoose";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  uploadedAssets,
  deletedAssets,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import Group from "../src/models/group.model.js";
import GroupMessage from "../src/models/group-message.model.js";
import GroupKey from "../src/models/group-key.model.js";
import LocationShare from "../src/models/location-share.model.js";
import { createGroupWithMembers } from "../src/services/groups/group-member.service.js";
import { endShare } from "../src/services/groups/group.service.js";
import {
  sendMessageLimiter,
  settingsLimiter,
} from "../src/middlewares/rateLimit/index.js";

function waitForEvent(socket, eventName, timeoutMs = 1500) {
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

async function resetLimiters(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(Boolean);
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await settingsLimiter.resetKey(k);
    } catch {}
  }
}

export const groupTestResults = [];
function recordResult(category, testName, expected, actual, pass, evidence = "") {
  groupTestResults.push({
    category,
    testName,
    expected,
    actual,
    pass,
    evidence: typeof evidence === "object" ? JSON.stringify(evidence) : String(evidence),
  });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`[${symbol}] [${category}] ${testName}`);
  if (!pass) {
    console.error(`       Expected: ${expected}`);
    console.error(`       Actual:   ${actual}`);
    if (evidence) console.error(`       Evidence: ${JSON.stringify(evidence)}`);
  }
}

async function runGroupTests() {
  console.log("\n==================================================");
  console.log("Starting Group Messaging Verification Suite");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port, io } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie, david, eve } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);
  const davidId = String(david.user._id);
  const eveId = String(eve.user._id);

  const resetLimits = async () => {
    await resetLimiters(aliceId, bobId, charlieId, davidId, eveId);
  };

  // Set groupAddPermission to "everyone" for Bob & Charlie
  await mongoose.model("User").updateMany(
    { _id: { $in: [bobId, charlieId] } },
    { $set: { groupAddPermission: "everyone" } },
  );

  let testGroupId = null;

  try {
    // ----------------------------------------------------
    // Category 1: Group Creation & Avatar Temp File Cleanup
    // ----------------------------------------------------
    console.log("\n--- Category 1: Group Creation & Temp File Cleanup ---");
    await resetLimits();

    // 1.1 Create valid group with members
    {
      const res = await request(app)
        .post("/api/v1/groups")
        .set("Cookie", alice.cookies)
        .send({
          name: "Engineers Club",
          memberIds: JSON.stringify([bobId, charlieId]),
        });
      const pass = res.status === 201 && res.body?.data?.name === "Engineers Club";
      testGroupId = res.body?.data?.id || res.body?.data?._id;
      recordResult("Group Creation", "Create valid group with members", 201, res.status, pass);
    }

    // 1.2 Temp file unlinked when group creation fails validation (Issue #2 fix)
    {
      const initialUploadFiles = fs.readdirSync("public/upload");
      const tmpFile = `/tmp/test_group_avatar_${Date.now()}.png`;
      fs.writeFileSync(tmpFile, "fake-avatar-bytes");

      const res = await request(app)
        .post("/api/v1/groups")
        .set("Cookie", alice.cookies)
        .attach("avatar", tmpFile)
        .field("name", "Invalid Group")
        .field("memberIds", JSON.stringify([davidId])); // Alice blocks David

      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );

      const pass = res.status === 403 && !leakedFile;
      recordResult(
        "Temp File Cleanup",
        "Avatar temp file unlinked when member validation fails",
        "Status 403 and zero leaked temp files",
        `Status ${res.status}, leaked files: ${leakedFile || "none"}`,
        pass,
      );
    }

    // 1.2b Service-level temp file unlinked by createGroupWithMembers on validation rejection
    {
      const tmpFile = `/tmp/test_service_avatar_${Date.now()}.png`;
      fs.writeFileSync(tmpFile, "fake-avatar-bytes");

      let caughtErr = null;
      try {
        await createGroupWithMembers({
          me: aliceId,
          name: "Direct Service Test",
          memberIds: [davidId], // Alice blocks David -> 403
          file: { path: tmpFile },
        });
      } catch (e) {
        caughtErr = e;
      }

      const fileStillExists = fs.existsSync(tmpFile);
      if (fileStillExists) fs.unlinkSync(tmpFile);

      const pass = caughtErr?.statusCode === 403 && !fileStillExists;
      recordResult(
        "Temp File Cleanup",
        "createGroupWithMembers unlinks temp file when member validation fails",
        "403 and temp file unlinked by service finally",
        `status=${caughtErr?.statusCode}, fileStillExists=${fileStillExists}`,
        pass,
      );
    }

    // 1.3 Multer failure path: autoCleanupMulterOnFailure cleans up temp file on PATCH /:id failure
    {
      await resetLimits();
      const initialUploadFiles = fs.readdirSync("public/upload");
      const tmpFile = `/tmp/test_patch_avatar_${Date.now()}.png`;
      fs.writeFileSync(tmpFile, "fake-avatar-bytes");

      // David is not a member of testGroupId, so getGroupAndMember throws 404
      const res = await request(app)
        .patch(`/api/v1/groups/${testGroupId}`)
        .set("Cookie", david.cookies)
        .attach("avatar", tmpFile)
        .field("name", "Hacked Group Name");

      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );

      const pass = res.status === 403 && !leakedFile;
      recordResult(
        "Temp File Cleanup",
        "autoCleanupMulterOnFailure cleans up temp file on PATCH /:id non-member failure",
        "Status 403 and zero leaked temp files",
        `Status ${res.status}, leaked files: ${leakedFile || "none"}`,
        pass,
      );
    }

    // 1.4 Multer failure path: enforceTypeSizeLimit rejects oversized file with 413 and unlinks temp file
    {
      await resetLimits();
      const initialUploadFiles = fs.readdirSync("public/upload");
      const tmpFile = `/tmp/test_oversized_${Date.now()}.png`;
      // MAX_NORMAL_FILE_SIZE is 10MB; 11MB file triggers 413
      fs.writeFileSync(tmpFile, Buffer.alloc(11 * 1024 * 1024));

      const res = await request(app)
        .patch(`/api/v1/groups/${testGroupId}`)
        .set("Cookie", alice.cookies)
        .attach("avatar", tmpFile);

      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );

      const pass = res.status === 413 && !leakedFile;
      recordResult(
        "Temp File Cleanup",
        "enforceTypeSizeLimit rejects oversized file with 413 and unlinks temp file",
        "Status 413 and zero leaked temp files",
        `Status ${res.status}, leaked files: ${leakedFile || "none"}`,
        pass,
      );
    }

    // 1.5 Initial avatar asset preserved on member validation rejection (Fix regression check)
    {
      const initialDeletedCount = deletedAssets.length;
      let caughtError = null;
      try {
        await createGroupWithMembers({
          me: aliceId,
          name: "Invalid Group",
          memberIds: [davidId], // Alice blocked David -> 403
          avatar: {
            public_id: "preset_user_avatar_123",
            secure_url: "https://res.cloudinary.com/test/image/upload/preset.jpg",
          },
        });
      } catch (err) {
        caughtError = err;
      }

      const assetWasDeleted = deletedAssets.some(
        (a) => a.publicId === "preset_user_avatar_123",
      );
      const pass = caughtError?.statusCode === 403 && !assetWasDeleted;
      recordResult(
        "Asset Safety",
        "Initial avatar asset not destroyed when member validation fails",
        "403 and initial asset preserved in Cloudinary",
        `status=${caughtError?.statusCode}, assetDeleted=${assetWasDeleted}`,
        pass,
      );
    }

    // 1.6 Aborted multipart client request cleans up temp files via res 'close' event
    {
      await resetLimits();
      const initialUploadFiles = fs.readdirSync("public/upload");
      const tmpFile = `/tmp/test_abort_${Date.now()}.png`;
      fs.writeFileSync(tmpFile, "abort-data-content");

      const req = request(app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", alice.cookies)
        .attach("image", tmpFile);

      setTimeout(() => req.abort(), 15);
      try {
        await req;
      } catch {}

      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      await new Promise((r) => setTimeout(r, 100));
      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );
      const pass = !leakedFile;
      recordResult(
        "Temp File Cleanup",
        "Aborted multipart request cleans up temp files on close event",
        "zero leaked files in public/upload",
        `leakedFile=${leakedFile || "none"}`,
        pass,
      );
    }

    // ----------------------------------------------------
    // Category 2: Group Messages & Message Temp File Cleanup
    // ----------------------------------------------------
    console.log("\n--- Category 2: Group Messages & Idempotency ---");
    await resetLimits();

    // 2.1 Send normal text message
    let testMsgId = null;
    {
      const res = await request(app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello team!" });
      const pass = res.status === 201 && res.body?.data?.text === "Hello team!";
      testMsgId = res.body?.data?.id || res.body?.data?._id;
      recordResult("Group Messages", "Send text message to group", 201, res.status, pass);
    }

    // 2.2 Idempotent send with clientId
    {
      const clientId = `client_msg_${Date.now()}`;
      const res1 = await request(app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", alice.cookies)
        .send({ text: "Idempotent text", clientId });
      const res2 = await request(app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", alice.cookies)
        .send({ text: "Idempotent text", clientId });

      const pass =
        res1.status === 201 &&
        res2.status === 200 &&
        (res1.body?.data?.id || res1.body?.data?._id) ===
          (res2.body?.data?.id || res2.body?.data?._id);
      recordResult("Group Messages", "Idempotent send with clientId returns 200 on duplicate", true, pass, pass);
    }

    // 2.3 Temp file unlinked when message validation fails (Issue #1 fix)
    {
      const initialUploadFiles = fs.readdirSync("public/upload");
      const tmpFile = `/tmp/test_group_msg_${Date.now()}.png`;
      fs.writeFileSync(tmpFile, "fake-image-bytes");

      const res = await request(app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", alice.cookies)
        .attach("image", tmpFile)
        .field("text", "a".repeat(2001)); // Exceeds MAX_GROUP_TEXT (2000)

      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );

      const pass = res.status === 400 && !leakedFile;
      recordResult(
        "Temp File Cleanup",
        "Image temp file unlinked on text validation failure",
        "Status 400 and zero leaked temp files",
        `Status ${res.status}, leaked files: ${leakedFile || "none"}`,
        pass,
      );
    }

    // 2.4 Idempotent send with image attachment and clientId returns 200 on duplicate & unlinks temp file
    {
      await resetLimits();
      const clientId = `client_msg_file_${Date.now()}`;
      const tmpFile1 = `/tmp/test_dup_1_${Date.now()}.png`;
      const tmpFile2 = `/tmp/test_dup_2_${Date.now()}.png`;
      fs.writeFileSync(tmpFile1, "fake-image-1");
      fs.writeFileSync(tmpFile2, "fake-image-2");

      const initialUploadFiles = fs.readdirSync("public/upload");

      // First send
      const res1 = await request(app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", alice.cookies)
        .attach("image", tmpFile1)
        .field("text", "Photo caption")
        .field("clientId", clientId);

      // Second send with same clientId and another attached image
      const res2 = await request(app)
        .post(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", alice.cookies)
        .attach("image", tmpFile2)
        .field("text", "Photo caption")
        .field("clientId", clientId);

      if (fs.existsSync(tmpFile1)) fs.unlinkSync(tmpFile1);
      if (fs.existsSync(tmpFile2)) fs.unlinkSync(tmpFile2);

      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );

      const id1 = res1.body?.data?.id || res1.body?.data?._id;
      const id2 = res2.body?.data?.id || res2.body?.data?._id;

      const pass =
        res1.status === 201 &&
        res2.status === 200 &&
        id1 === id2 &&
        !leakedFile;

      recordResult(
        "Group Messages",
        "Idempotent send with image attachment and clientId returns 200 & unlinks temp file",
        "201 then 200 with matching IDs and zero leaked temp files",
        `res1=${res1.status}, res2=${res2.status}, match=${id1 === id2}, leakedFile=${leakedFile || "none"}`,
        pass,
      );
    }

    // 2.4 Edit text message within window
    {
      const res = await request(app)
        .patch(`/api/v1/groups/${testGroupId}/messages/${testMsgId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello team! (Edited)" });
      const pass =
        res.status === 200 &&
        res.body?.data?.text === "Hello team! (Edited)" &&
        res.body?.data?.isEdited === true;
      recordResult("Group Messages", "Edit message within window", 200, res.status, pass);
    }

    // 2.5 Non-sender cannot edit message
    {
      const res = await request(app)
        .patch(`/api/v1/groups/${testGroupId}/messages/${testMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ text: "Hacked text" });
      const pass = res.status === 403;
      recordResult("Group Security", "Non-sender edit rejected with 403", 403, res.status, pass);
    }

    // ----------------------------------------------------
    // Category 3: Read Receipts & JoinedAt Rules
    // ----------------------------------------------------
    console.log("\n--- Category 3: Read Receipts & JoinedAt Rules ---");
    await resetLimits();

    // 3.1 Bob marks group messages as seen
    {
      const res = await request(app)
        .post(`/api/v1/groups/${testGroupId}/seen`)
        .set("Cookie", bob.cookies)
        .send({});
      const pass = res.status === 200 && typeof res.body?.data?.count === "number";
      recordResult("Read Receipts", "Mark group messages seen returns count", 200, res.status, pass);
    }

    // 3.2 Get my groups list respects joinedAt and unreadCount
    {
      const res = await request(app)
        .get("/api/v1/groups")
        .set("Cookie", bob.cookies);
      const groupCard = (res.body?.data || []).find(
        (g) => String(g.id || g._id) === String(testGroupId),
      );
      const pass = res.status === 200 && groupCard?.unreadCount === 0;
      recordResult("Data Correctness", "Group card unreadCount reflects seen status", true, pass, pass);
    }

    // ----------------------------------------------------
    // Category 4: Member Management & RBAC Hierarchy
    // ----------------------------------------------------
    console.log("\n--- Category 4: Member Management & RBAC Hierarchy ---");
    await resetLimits();

    // 4.1 Admin/Owner changes member role
    {
      const res = await request(app)
        .patch(`/api/v1/groups/${testGroupId}/members/${bobId}/role`)
        .set("Cookie", alice.cookies)
        .send({ role: "admin" });
      const pass = res.status === 200;
      recordResult("Member Management", "Owner promotes member to admin", 200, res.status, pass);
    }

    // 4.2 Non-owner admin cannot demote another admin
    {
      const res = await request(app)
        .patch(`/api/v1/groups/${testGroupId}/members/${aliceId}/role`)
        .set("Cookie", bob.cookies)
        .send({ role: "member" });
      const pass = res.status === 403;
      recordResult("RBAC Hierarchy", "Non-owner admin cannot demote owner or another admin", 403, res.status, pass);
    }

    // 4.3 Owner removes a member
    {
      const res = await request(app)
        .delete(`/api/v1/groups/${testGroupId}/members/${charlieId}`)
        .set("Cookie", alice.cookies);
      const pass = res.status === 200;
      recordResult("Member Management", "Owner removes member", 200, res.status, pass);
    }

    // 4.4 Removed member cannot fetch group messages
    {
      const res = await request(app)
        .get(`/api/v1/groups/${testGroupId}/messages`)
        .set("Cookie", charlie.cookies);
      const pass = res.status === 403;
      recordResult("Group Security", "Removed member fetching messages rejected with 403", 403, res.status, pass);
    }

    // ----------------------------------------------------
    // Category 5: Location Sharing Lifecycle
    // ----------------------------------------------------
    console.log("\n--- Category 5: Location Sharing Lifecycle ---");
    await resetLimits();

    let shareId = null;
    // 5.1 Start live location share
    {
      const res = await request(app)
        .post(`/api/v1/groups/${testGroupId}/location`)
        .set("Cookie", alice.cookies)
        .send({
          mode: "live",
          lat: 28.6139,
          lng: 77.209,
          durationMin: 15,
        });
      shareId = String(res.body?.data?.share?._id || res.body?.data?.share?.id);
      const pass = res.status === 201 && Boolean(shareId);
      recordResult("Location Sharing", "Start live location share in group", 201, res.status, pass);
    }

    // 5.2 Stop live location share & verify socket delivery via bounded promise
    {
      if (!bob.socket.connected || !charlie.socket.connected) {
        throw new Error("Sockets must be connected at emit time");
      }

      const bobPromise = waitForEvent(bob.socket, "group:location:ended", 2000);
      const charliePromise = waitForEvent(charlie.socket, "group:location:ended", 300);

      const res = await request(app)
        .post(`/api/v1/groups/${testGroupId}/location/${shareId}/stop`)
        .set("Cookie", alice.cookies)
        .send({});

      const [bobEvent, charlieEvent] = await Promise.all([bobPromise, charliePromise]);

      const socketOk =
        bobEvent.received &&
        String(bobEvent.data?.groupId) === String(testGroupId) &&
        String(bobEvent.data?.shareId) === String(shareId) &&
        !charlieEvent.received;

      const pass = res.status === 200 && socketOk;
      recordResult(
        "Location Sharing",
        "Stop live location share (room receives, removed member does not)",
        "200 & bobReceived=true & charlieReceived=false",
        `status=${res.status}, bobReceived=${bobEvent.received}, charlieReceived=${charlieEvent.received}`,
        pass,
      );
    }

    // 5.3 endShare with stale in-memory members does not leak to removed member (Issue #5 mutation check)
    {
      if (!bob.socket.connected || !charlie.socket.connected) {
        throw new Error("Sockets must be connected");
      }

      const testShare = await LocationShare.create({
        groupId: testGroupId,
        sharerId: aliceId,
        status: "active",
        expiresAt: new Date(Date.now() + 60000),
      });

      const bobPromise = waitForEvent(bob.socket, "group:location:ended", 2000);
      const charliePromise = waitForEvent(charlie.socket, "group:location:ended", 300);

      // Stale group object with Charlie still in members list
      const staleGroup = {
        _id: testGroupId,
        members: [{ userId: aliceId }, { userId: bobId }, { userId: charlieId }],
      };

      await endShare(staleGroup, testShare, "stopped");

      const [bobEvent, charlieEvent] = await Promise.all([bobPromise, charliePromise]);

      const pass = bobEvent.received && !charlieEvent.received;
      recordResult(
        "Location Sharing",
        "endShare with stale group members does not leak location:ended to evicted member",
        "bobReceived=true & charlieReceived=false",
        `bobReceived=${bobEvent.received}, charlieReceived=${charlieEvent.received}`,
        pass,
      );
    }

    // ----------------------------------------------------
    // Category 6: Delete Message & Group Deletion
    // ----------------------------------------------------
    console.log("\n--- Category 6: Delete Message & Group Deletion ---");
    await resetLimits();

    // 6.1 Delete group message
    {
      const res = await request(app)
        .delete(`/api/v1/groups/${testGroupId}/messages/${testMsgId}`)
        .set("Cookie", alice.cookies);
      const pass = res.status === 200;
      recordResult("Group Messages", "Delete message from group", 200, res.status, pass);
    }

    // 6.2 Non-owner cannot delete group
    {
      const res = await request(app)
        .delete(`/api/v1/groups/${testGroupId}`)
        .set("Cookie", bob.cookies);
      const pass = res.status === 403;
      recordResult("Group Security", "Non-owner delete group rejected with 403", 403, res.status, pass);
    }

    // 6.3 Owner deletes group (cascade cleanup)
    {
      const res = await request(app)
        .delete(`/api/v1/groups/${testGroupId}`)
        .set("Cookie", alice.cookies);
      const groupInDb = await Group.findById(testGroupId);
      const msgsInDb = await GroupMessage.find({ groupId: testGroupId });
      const pass = res.status === 200 && !groupInDb && msgsInDb.length === 0;
      recordResult("Group Lifecycle", "Owner deletes group with complete cascade DB cleanup", true, pass, pass);
    }

  } catch (err) {
    console.error("Unhandled error in group test suite:", err);
  } finally {
    // Disconnect sockets
    for (const s of Object.values(users)) {
      if (s?.socket?.connected) s.socket.disconnect();
    }
    await teardownTestEnvironment();
  }

  const passedCount = groupTestResults.filter((r) => r.pass).length;
  const totalCount = groupTestResults.length;
  console.log(`\n==================================================`);
  console.log(`GROUP TEST SUITE: Total: ${totalCount} | Passed: ${passedCount} | Failed: ${totalCount - passedCount}`);
  console.log(`==================================================\n`);

  process.exit(passedCount === totalCount ? 0 : 1);
}

runGroupTests();
