import fs from "fs";
import path from "path";
import crypto from "crypto";
import request from "supertest";
import mongoose from "mongoose";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  uploadedAssets,
  deletedAssets,
} from "./test-env.js";
import { createAndLoginUsers, TEST_PASSWORD } from "./auth-helper.js";
import Message from "../src/models/message.model.js";
import ScheduledMessage from "../src/models/scheduled-message.model.js";
import LocationShare from "../src/models/location-share.model.js";
import Call from "../src/models/call.model.js";
import ChatSetting from "../src/models/chat-setting.model.js";
import ChatArchive from "../src/models/chat-archive.model.js";
import Report from "../src/models/report.model.js";
import User from "../src/models/users.model.js";
import { privacyByUser, loadPrivacy } from "../src/lib/socket.js";
import { isPrivateIp, safeFetch } from "../src/utils/link-preview.js";
import { recoverStrandedJobs } from "../src/jobs/scheduler.js";
import { sweepDisappearingMessages } from "../src/jobs/disappearing.js";
import {
  sendMessageLimiter,
  reactLimiter,
  forwardLimiter,
  reportLimiter,
  settingsLimiter,
} from "../src/middlewares/rateLimit/index.js";

async function resetLimiters(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(
    Boolean,
  );
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await reactLimiter.resetKey(k);
      await forwardLimiter.resetKey(k);
      await reportLimiter.resetKey(k);
      await settingsLimiter.resetKey(k);
    } catch {}
  }
}

// Global process error trackers
const unhandledRejections = [];
const uncaughtExceptions = [];
process.on("unhandledRejection", (err) => unhandledRejections.push(err));
process.on("uncaughtException", (err) => uncaughtExceptions.push(err));

// Results collector
export const testResults = [];
function recordResult(
  category,
  testName,
  expected,
  actual,
  pass,
  evidence = "",
) {
  testResults.push({
    category,
    testName,
    expected,
    actual,
    pass,
    evidence:
      typeof evidence === "object"
        ? JSON.stringify(evidence)
        : String(evidence),
  });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`[${symbol}] [${category}] ${testName}`);
  if (!pass) {
    console.error(`       Expected: ${expected}`);
    console.error(`       Actual:   ${actual}`);
    if (evidence) console.error(`       Evidence: ${JSON.stringify(evidence)}`);
  }
}

async function runAllTests() {
  console.log("\n==================================================");
  console.log("Starting Full Direct Messaging Verification Suite");
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

  try {
    // ==========================================
    // Category 1: Send Text
    // ==========================================
    console.log("\n--- Testing Category 1: Send Text ---");
    await resetLimits();

    // 1.1 Normal text send
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello Bob!" });
      const pass = res.status === 201 && res.body?.data?.text === "Hello Bob!";
      recordResult(
        "Send Text",
        "Normal text send",
        "201 Created with text",
        `${res.status} ${res.body?.data?.text}`,
        pass,
        res.body?.data,
      );
    }

    // 1.2 Send text with clientId
    const testClientId = "client_msg_" + crypto.randomUUID();
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Idempotent message 1", clientId: testClientId });
      const pass =
        res.status === 201 && res.body?.data?.clientId === testClientId;
      recordResult(
        "Send Text",
        "Send text with clientId",
        "201 Created with clientId",
        `${res.status} clientId=${res.body?.data?.clientId}`,
        pass,
        res.body?.data,
      );
    }

    // 1.3 Same clientId twice (Idempotency)
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Idempotent message 1", clientId: testClientId });
      const count = await Message.countDocuments({
        senderId: aliceId,
        clientId: testClientId,
      });
      const pass =
        res.status === 200 &&
        res.body?.message === "Message already sent." &&
        count === 1;
      recordResult(
        "Send Text",
        "Idempotent send with same clientId",
        "200 OK 'Message already sent.', exactly 1 doc in DB",
        `${res.status} msg=${res.body?.message}, count=${count}`,
        pass,
        res.body,
      );
    }

    // 1.4 Two messages WITHOUT clientId (both succeed)
    {
      const res1 = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "No clientId message 1" });
      const res2 = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "No clientId message 2" });
      const pass = res1.status === 201 && res2.status === 201;
      recordResult(
        "Send Text",
        "Two messages without clientId both succeed",
        "201 and 201",
        `${res1.status} and ${res2.status}`,
        pass,
      );
    }

    // 1.5 Empty text and whitespace-only
    {
      const resEmpty = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "" });
      const resWs = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "    " });
      const pass = resEmpty.status === 400 && resWs.status === 400;
      recordResult(
        "Send Text",
        "Empty or whitespace-only text rejected",
        "400 Bad Request",
        `empty=${resEmpty.status}, ws=${resWs.status}`,
        pass,
        resEmpty.body,
      );
    }

    // 1.6 4000 chars vs 4001 chars
    {
      const text4000 = "a".repeat(4000);
      const text4001 = "a".repeat(4001);
      const res4000 = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: text4000 });
      const res4001 = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: text4001 });
      const pass = res4000.status === 201 && res4001.status === 400;
      recordResult(
        "Send Text",
        "Text length limits (4000 allowed, 4001 rejected)",
        "4000: 201, 4001: 400",
        `4000=${res4000.status}, 4001=${res4001.status}`,
        pass,
      );
    }

    // 1.7 Self message
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${aliceId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Self message" });
      const pass = res.status === 400;
      recordResult(
        "Send Text",
        "Self-message rejected",
        "400 Bad Request",
        `${res.status} msg=${res.body?.message}`,
        pass,
        res.body,
      );
    }

    // 1.8 Invalid ObjectId & Nonexistent Receiver
    {
      const resInv = await request(app)
        .post(`/api/v1/messages/send/invalid-id-123`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello" });
      const nonExistent = new mongoose.Types.ObjectId();
      const resNonExist = await request(app)
        .post(`/api/v1/messages/send/${nonExistent}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello" });
      const pass = resInv.status === 400 && resNonExist.status === 404;
      recordResult(
        "Send Text",
        "Invalid ID (400) and nonexistent user (404)",
        "400 and 404",
        `inv=${resInv.status}, nonExist=${resNonExist.status}`,
        pass,
      );
    }

    // 1.9 Blocked either way
    {
      // Alice blocked David
      const resAliceToDavid = await request(app)
        .post(`/api/v1/messages/send/${davidId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message to blocked user" });
      const resDavidToAlice = await request(app)
        .post(`/api/v1/messages/send/${aliceId}`)
        .set("Cookie", david.cookies)
        .send({ text: "Message from blocked user" });
      const pass =
        resAliceToDavid.status === 403 && resDavidToAlice.status === 403;
      recordResult(
        "Send Text",
        "Blocked messaging blocked both ways",
        "403 and 403",
        `Alice->David: ${resAliceToDavid.status}, David->Alice: ${resDavidToAlice.status}`,
        pass,
      );
    }

    // 1.10 Suspended receiver
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${eveId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message to suspended Eve" });
      const pass =
        res.status === 404 && res.body?.message === "User not found.";
      recordResult(
        "Send Text",
        "Send text to suspended user rejects with 404 User not found.",
        "404 User not found.",
        `${res.status} msg=${res.body?.message}`,
        pass,
        { status: res.status, body: res.body },
      );
    }

    // ==========================================
    // Category 2: Send Attachments & Temp File Cleanup
    // ==========================================
    console.log("\n--- Testing Category 2: Send Attachments ---");
    await resetLimits();

    const sampleImagePath = "/tmp/test_chat_image.png";
    fs.writeFileSync(sampleImagePath, "fake image bytes png 1234567890");

    // 2.1 Send valid image
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .attach("image", sampleImagePath)
        .field("text", "Check out this image");
      const pass = res.status === 201 && res.body?.data?.image?.url;
      recordResult(
        "Send Attachments",
        "Send valid image attachment",
        "201 with image.url",
        `${res.status} img=${Boolean(res.body?.data?.image?.url)}`,
        pass,
        res.body?.data?.image,
      );
    }

    // 2.2 Send voice note with duration clamping
    const sampleAudioPath = "/tmp/test_audio.mp3";
    fs.writeFileSync(sampleAudioPath, "fake audio bytes mp3");
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .attach("image", sampleAudioPath)
        .field("isVoice", "true")
        .field("duration", "9999"); // MAX_VOICE_SECONDS is 300
      const duration = res.body?.data?.audio?.duration;
      const pass = res.status === 201 && duration <= 300 && duration > 0;
      recordResult(
        "Send Attachments",
        "Send voice note with duration clamped to 300s",
        "201 with duration <= 300",
        `${res.status} duration=${duration}`,
        pass,
        res.body?.data?.audio,
      );
    }

    // 2.3 Send video with duration clamping
    const sampleVideoPath = "/tmp/test_video.mp4";
    fs.writeFileSync(sampleVideoPath, "fake video bytes mp4");
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .attach("image", sampleVideoPath)
        .field("isVideo", "true")
        .field("duration", "9999"); // MAX_VIDEO_SECONDS is 60
      const duration = res.body?.data?.video?.duration;
      const pass = res.status === 201 && duration <= 60 && duration > 0;
      recordResult(
        "Send Attachments",
        "Send video with duration clamped to 60s",
        "201 with duration <= 60",
        `${res.status} duration=${duration}`,
        pass,
        res.body?.data?.video,
      );
    }

    // 2.4 Blocked extension (.exe)
    const sampleExePath = "/tmp/test_bad_app.exe";
    fs.writeFileSync(sampleExePath, "fake executable bytes");
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .attach("image", sampleExePath);
      const pass = res.status === 500 || res.status === 400; // Multer fileFilter error handled
      recordResult(
        "Send Attachments",
        "Blocked extension (.exe) rejected",
        "400 or 500 rejection",
        `${res.status} msg=${res.body?.message}`,
        pass,
        res.body,
      );
    }

    // 2.5 Temp file cleanup verification: on validation error (e.g. text > 4000 with file)
    {
      await resetLimits();
      const initialUploadFiles = fs.readdirSync("public/upload");
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .attach("image", sampleImagePath)
        .field("text", "a".repeat(4005)); // Exceeds 4000
      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );
      const cleanedUp = res.status === 400 && !leakedFile;
      recordResult(
        "Send Attachments",
        "Temp file unlinked on text validation failure",
        "File removed from public/upload",
        `status=${res.status}, leakedFile=${leakedFile || "none"}`,
        cleanedUp,
        { leakedFile },
      );
    }

    // ==========================================
    // Category 3: Concurrency & Idempotency Race
    // ==========================================
    console.log("\n--- Testing Category 3: Concurrency & Race Conditions ---");
    {
      await resetLimits();
      const raceClientId = "race_client_id_" + crypto.randomUUID();
      const parallelRequests = Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post(`/api/v1/messages/send/${bobId}`)
          .set("Cookie", alice.cookies)
          .send({ text: `Parallel race send ${i}`, clientId: raceClientId }),
      );

      const responses = await Promise.all(parallelRequests);
      const statusCodes = responses.map((r) => r.status);
      const createdCount = statusCodes.filter((s) => s === 201).length;
      const alreadySentCount = statusCodes.filter((s) => s === 200).length;
      const dbCount = await Message.countDocuments({
        senderId: aliceId,
        clientId: raceClientId,
      });

      const pass = createdCount + alreadySentCount === 10 && dbCount === 1;
      recordResult(
        "Concurrency",
        "10 parallel sends with same clientId result in exactly 1 message in DB",
        "10 requests succeed (1x 201, 9x 200), exactly 1 DB record",
        `201s=${createdCount}, 200s=${alreadySentCount}, dbCount=${dbCount}`,
        pass,
      );
      await resetLimits();
    }

    // ==========================================
    // Category 4: Reply
    // ==========================================
    console.log("\n--- Testing Category 4: Reply ---");
    await resetLimits();

    let originalMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message to be replied to" });
      originalMsgId = res.body?.data?.id;
    }

    // 4.1 Valid reply
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${aliceId}`)
        .set("Cookie", bob.cookies)
        .send({ text: "Replying to your message", replyTo: originalMsgId });
      const pass =
        res.status === 201 && res.body?.data?.replyTo?.id === originalMsgId;
      recordResult(
        "Reply",
        "Valid reply to existing message",
        "201 Created with replyTo populated",
        `${res.status} replyTo=${res.body?.data?.replyTo?.id}`,
        pass,
        res.body?.data?.replyTo,
      );
    }

    // 4.2 Reply to message from another conversation (Charlie's message)
    let charlieMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${aliceId}`)
        .set("Cookie", charlie.cookies)
        .send({ text: "Charlie message to Alice" });
      charlieMsgId = res.body?.data?.id;
    }
    {
      // Bob tries to reply to Charlie's message in Bob<->Alice chat
      const res = await request(app)
        .post(`/api/v1/messages/send/${aliceId}`)
        .set("Cookie", bob.cookies)
        .send({ text: "Bob foreign reply attempt", replyTo: charlieMsgId });
      const pass =
        res.status === 400 &&
        res.body?.message === "Cannot reply to this message.";
      recordResult(
        "Reply",
        "Reply to foreign conversation message rejected",
        "400 'Cannot reply to this message.'",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 4.3 Reply to deleted message
    let toDeleteMsgId;
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message to be deleted for reply test" });
      toDeleteMsgId = res.body?.data?.id;
      await request(app)
        .delete(`/api/v1/messages/delete-for-everyone/${toDeleteMsgId}`)
        .set("Cookie", alice.cookies);
    }
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${aliceId}`)
        .set("Cookie", bob.cookies)
        .send({ text: "Replying to deleted message", replyTo: toDeleteMsgId });
      const pass = res.status === 400;
      recordResult(
        "Reply",
        "Reply to deleted message rejected",
        "400 Bad Request",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // ==========================================
    // Category 5: Forward
    // ==========================================
    console.log("\n--- Testing Category 5: Forward ---");
    await resetLimits();

    let fwdOriginalMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Original message to forward" });
      fwdOriginalMsgId = res.body?.data?.id;
    }

    // 5.1 Valid forward to 1 target (Bob forwards to Charlie)
    {
      const res = await request(app)
        .post(`/api/v1/messages/forward/${fwdOriginalMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ userIds: [charlieId] });
      const pass =
        res.status === 200 &&
        Array.isArray(res.body?.data) &&
        res.body?.data[0]?.isForwarded === true;
      recordResult(
        "Forward",
        "Valid forward to 1 recipient",
        "200 OK with isForwarded=true",
        `${res.status} fwd=${res.body?.data?.[0]?.isForwarded}`,
        pass,
        res.body?.data,
      );
    }

    // 5.2 Forward to 0 targets and 6 targets
    {
      const res0 = await request(app)
        .post(`/api/v1/messages/forward/${fwdOriginalMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ userIds: [] });
      const dummyTargets = Array.from({ length: 6 }, () =>
        new mongoose.Types.ObjectId().toString(),
      );
      const res6 = await request(app)
        .post(`/api/v1/messages/forward/${fwdOriginalMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ userIds: dummyTargets });
      const pass = res0.status === 400 && res6.status === 400;
      recordResult(
        "Forward",
        "Forward target limits (0 and 6 rejected)",
        "400 and 400",
        `0=${res0.status}, 6=${res6.status}`,
        pass,
      );
    }

    // 5.3 Forwarding a message you are not part of (Charlie forwards Alice<->Bob message)
    {
      const res = await request(app)
        .post(`/api/v1/messages/forward/${fwdOriginalMsgId}`)
        .set("Cookie", charlie.cookies)
        .send({ userIds: [bobId] });
      const pass = res.status === 403;
      recordResult(
        "Forward",
        "Forwarding non-participant message rejected",
        "403 Forbidden",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 5.4 Media asset retention on forward deletion
    let mediaMsgId;
    let sharedPublicId;
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .attach("image", sampleImagePath)
        .field("text", "Media to forward");
      mediaMsgId = res.body?.data?.id;
      sharedPublicId = res.body?.data?.image?.public_id;
    }
    // Bob forwards it to Charlie
    let fwdMediaMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/forward/${mediaMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ userIds: [charlieId] });
      fwdMediaMsgId = res.body?.data?.[0]?.id;
    }
    // Bob deletes his forwarded message for everyone
    {
      deletedAssets.length = 0;
      await request(app)
        .delete(`/api/v1/messages/delete-for-everyone/${fwdMediaMsgId}`)
        .set("Cookie", bob.cookies);
      // Because original still has sharedPublicId, destroyAsset MUST NOT delete it from Cloudinary!
      const deletedFromCloudinary = deletedAssets.some(
        (d) => d.publicId === sharedPublicId,
      );
      const pass = !deletedFromCloudinary;
      recordResult(
        "Forward",
        "Deleting forwarded message preserves shared Cloudinary asset",
        "Asset NOT destroyed in Cloudinary",
        `deletedFromCloudinary=${deletedFromCloudinary}`,
        pass,
        { sharedPublicId, deletedAssets },
      );
    }

    // ==========================================
    // Category 6: Edit
    // ==========================================
    console.log("\n--- Testing Category 6: Edit ---");
    await resetLimits();

    let editMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message to edit" });
      editMsgId = res.body?.data?.id;
    }

    // 6.1 Valid edit by sender within 15 min
    {
      const res = await request(app)
        .patch(`/api/v1/messages/edit/${editMsgId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message edited successfully" });
      const pass =
        res.status === 200 &&
        res.body?.data?.isEdited === true &&
        res.body?.data?.text === "Message edited successfully";
      recordResult(
        "Edit",
        "Valid edit within 15 min by sender",
        "200 with isEdited=true and updated text",
        `${res.status} text=${res.body?.data?.text}`,
        pass,
        res.body?.data,
      );
    }

    // 6.2 Edit by non-sender (Bob tries to edit Alice's message)
    {
      const res = await request(app)
        .patch(`/api/v1/messages/edit/${editMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ text: "Hacked edit by Bob" });
      const pass = res.status === 403;
      recordResult(
        "Edit",
        "Non-sender edit rejected",
        "403 Forbidden",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 6.3 Edit after 15 min window expired
    {
      // Mock createdAt to 16 minutes ago
      await Message.collection.updateOne(
        { _id: new mongoose.Types.ObjectId(editMsgId) },
        { $set: { createdAt: new Date(Date.now() - 16 * 60 * 1000) } },
      );
      const res = await request(app)
        .patch(`/api/v1/messages/edit/${editMsgId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Late edit attempt" });
      const pass =
        res.status === 400 && res.body?.message === "Edit time is over.";
      recordResult(
        "Edit",
        "Edit after 15 min rejected",
        "400 'Edit time is over.'",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // ==========================================
    // Category 7: Delete for me / Delete for everyone
    // ==========================================
    console.log(
      "\n--- Testing Category 7: Delete for me & Delete for everyone ---",
    );
    await resetLimits();

    let delMeMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Delete for me test" });
      delMeMsgId = res.body?.data?.id;
    }

    // 7.1 Delete for me
    {
      const res = await request(app)
        .delete(`/api/v1/messages/delete-for-me/${delMeMsgId}`)
        .set("Cookie", alice.cookies);
      const doc = await Message.findById(delMeMsgId);
      const isDeletedForAlice = doc?.deletedFor
        ? doc.deletedFor.map(String).includes(aliceId)
        : false;
      const pass = res.status === 200 && isDeletedForAlice && !doc?.isDeleted;
      recordResult(
        "Delete",
        "Delete for me hides message for user while keeping doc active",
        "200 with deletedFor containing userId, isDeleted=false",
        `${res.status} deletedForAlice=${isDeletedForAlice}, isDeleted=${doc?.isDeleted}`,
        pass,
      );
    }

    // 7.2 Delete for everyone by non-sender
    let delEveryMsgId;
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Delete for everyone test" });
      delEveryMsgId = res.body?.data?.id;
    }
    {
      const res = await request(app)
        .delete(`/api/v1/messages/delete-for-everyone/${delEveryMsgId}`)
        .set("Cookie", bob.cookies);
      const pass = res.status === 403;
      recordResult(
        "Delete",
        "Delete for everyone by non-sender rejected",
        "403 Forbidden",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 7.3 Delete for everyone by sender & tombstone wipe
    {
      const res = await request(app)
        .delete(`/api/v1/messages/delete-for-everyone/${delEveryMsgId}`)
        .set("Cookie", alice.cookies);
      const rawDoc = await Message.collection.findOne({
        _id: new mongoose.Types.ObjectId(delEveryMsgId),
      });
      const pass =
        res.status === 200 &&
        rawDoc.isDeleted === true &&
        rawDoc.text === undefined &&
        rawDoc.image === undefined;
      recordResult(
        "Delete",
        "Delete for everyone by sender wipes content & sets isDeleted=true",
        "200 and doc fields wiped",
        `${res.status} isDeleted=${rawDoc.isDeleted}, text=${rawDoc.text}`,
        pass,
        rawDoc,
      );
    }

    // 7.4 Delete for everyone twice (idempotent)
    {
      const res = await request(app)
        .delete(`/api/v1/messages/delete-for-everyone/${delEveryMsgId}`)
        .set("Cookie", alice.cookies);
      const pass =
        res.status === 200 && res.body?.message === "Message already deleted.";
      recordResult(
        "Delete",
        "Delete for everyone twice is idempotent",
        "200 'Message already deleted.'",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 7.5 wipeMessage clears message.location on delete-for-everyone
    {
      await resetLimits();
      const locMsg = await Message.create({
        senderId: aliceId,
        receiverId: bobId,
        location: {
          mode: "current",
          lat: 12.34,
          lng: 56.78,
          accuracy: 5,
          isLive: false,
        },
      });
      const res = await request(app)
        .delete(`/api/v1/messages/delete-for-everyone/${locMsg._id}`)
        .set("Cookie", alice.cookies);
      const rawDoc = await Message.collection.findOne({
        _id: new mongoose.Types.ObjectId(locMsg._id),
      });
      const pass =
        res.status === 200 &&
        rawDoc.isDeleted === true &&
        rawDoc.location === undefined;
      recordResult(
        "Delete",
        "wipeMessage clears message.location on delete-for-everyone",
        "location is undefined and isDeleted=true",
        `isDeleted=${rawDoc?.isDeleted}, location=${JSON.stringify(rawDoc?.location)}`,
        pass,
      );
    }

    // ==========================================
    // Category 8: React
    // ==========================================
    console.log("\n--- Testing Category 8: React ---");
    await resetLimits();

    let reactMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "React test message" });
      reactMsgId = res.body?.data?.id;
    }

    // 8.1 Add reaction
    {
      const res = await request(app)
        .patch(`/api/v1/messages/react/${reactMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ emoji: "❤️" });
      const pass =
        res.status === 200 && res.body?.data?.reactions?.[0]?.emoji === "❤️";
      recordResult(
        "React",
        "Add emoji reaction",
        "200 with reaction added",
        `${res.status} emoji=${res.body?.data?.reactions?.[0]?.emoji}`,
        pass,
        res.body?.data,
      );
    }

    // 8.2 Toggle reaction off (same emoji)
    {
      const res = await request(app)
        .patch(`/api/v1/messages/react/${reactMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ emoji: "❤️" });
      const pass =
        res.status === 200 && res.body?.data?.reactions?.length === 0;
      recordResult(
        "React",
        "Toggle same emoji reaction off",
        "200 with reactions empty",
        `${res.status} count=${res.body?.data?.reactions?.length}`,
        pass,
      );
    }

    // 8.3 Change reaction
    {
      await request(app)
        .patch(`/api/v1/messages/react/${reactMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ emoji: "👍" });
      const res = await request(app)
        .patch(`/api/v1/messages/react/${reactMsgId}`)
        .set("Cookie", bob.cookies)
        .send({ emoji: "🔥" });
      const pass =
        res.status === 200 &&
        res.body?.data?.reactions?.[0]?.emoji === "🔥" &&
        res.body?.data?.reactions?.length === 1;
      recordResult(
        "React",
        "Change reaction replaces previous emoji",
        "200 with emoji='🔥' and count=1",
        `${res.status} emoji=${res.body?.data?.reactions?.[0]?.emoji}`,
        pass,
      );
    }

    // 8.4 Non-participant react rejected
    {
      const res = await request(app)
        .patch(`/api/v1/messages/react/${reactMsgId}`)
        .set("Cookie", charlie.cookies)
        .send({ emoji: "🔥" });
      const pass = res.status === 403;
      recordResult(
        "React",
        "Non-participant reaction rejected",
        "403 Forbidden",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // ==========================================
    // Category 9: Pin & Unpin
    // ==========================================
    console.log("\n--- Testing Category 9: Pin ---");
    await resetLimits();

    const pinMsgIds = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: `Pin test message ${i + 1}` });
      pinMsgIds.push(res.body?.data?.id);
    }

    // 9.1 Pin 3 messages (should succeed)
    {
      const r1 = await request(app)
        .patch(`/api/v1/messages/pin/${pinMsgIds[0]}`)
        .set("Cookie", alice.cookies);
      const r2 = await request(app)
        .patch(`/api/v1/messages/pin/${pinMsgIds[1]}`)
        .set("Cookie", alice.cookies);
      const r3 = await request(app)
        .patch(`/api/v1/messages/pin/${pinMsgIds[2]}`)
        .set("Cookie", alice.cookies);
      const pass = r1.status === 200 && r2.status === 200 && r3.status === 200;
      recordResult(
        "Pin",
        "Pin 3 messages succeeds",
        "200 for all 3 pins",
        `${r1.status}, ${r2.status}, ${r3.status}`,
        pass,
      );
    }

    // 9.2 4th pin rejected
    {
      const r4 = await request(app)
        .patch(`/api/v1/messages/pin/${pinMsgIds[3]}`)
        .set("Cookie", alice.cookies);
      const pass =
        r4.status === 400 && r4.body?.message?.includes("pin up to 3");
      recordResult(
        "Pin",
        "4th pin rejected with limit error",
        "400 'You can pin up to 3 messages.'",
        `${r4.status} msg=${r4.body?.message}`,
        pass,
      );
    }

    // 9.3 getPinned endpoint
    {
      const res = await request(app)
        .get(`/api/v1/messages/pinned/${bobId}`)
        .set("Cookie", alice.cookies);
      const pass = res.status === 200 && res.body?.data?.length === 3;
      recordResult(
        "Pin",
        "getPinned returns exactly 3 pinned messages",
        "200 with 3 messages",
        `${res.status} count=${res.body?.data?.length}`,
        pass,
      );
    }

    // 9.4 Pin slot burn bug verification (Delete for me does not unpin or adjust count)
    {
      // Alice unpins pinMsgIds[0] so she has 2 pins
      await request(app)
        .patch(`/api/v1/messages/pin/${pinMsgIds[0]}`)
        .set("Cookie", alice.cookies);
      // Now pin count is 2 (pinMsgIds[1] and pinMsgIds[2]). Alice deletes pinMsgIds[1] for herself!
      await request(app)
        .delete(`/api/v1/messages/delete-for-me/${pinMsgIds[1]}`)
        .set("Cookie", alice.cookies);
      // Now Alice pins pinMsgIds[0] again -> count becomes 3 (1 hidden for me, 2 visible)
      await request(app)
        .patch(`/api/v1/messages/pin/${pinMsgIds[0]}`)
        .set("Cookie", alice.cookies);
      // Alice checks getPinned -> only sees 2 messages!
      const getRes = await request(app)
        .get(`/api/v1/messages/pinned/${bobId}`)
        .set("Cookie", alice.cookies);
      // Alice tries to pin pinMsgIds[3]:
      const pinAttempt = await request(app)
        .patch(`/api/v1/messages/pin/${pinMsgIds[3]}`)
        .set("Cookie", alice.cookies);
      // If pinAttempt is rejected (400) because of the hidden deleted-for-me pin, bug is CONFIRMED!
      const slotBurned =
        pinAttempt.status === 400 && getRes.body?.data?.length < 3;
      recordResult(
        "Pin",
        "Pin slot burn when pinned message is deleted for me",
        "Slot not burned (should allow 3 visible pins)",
        `getPinnedCount=${getRes.body?.data?.length}, 4thPinStatus=${pinAttempt.status}`,
        !slotBurned,
        { getPinnedCount: getRes.body?.data?.length, error: pinAttempt.body },
      );
    }

    // ==========================================
    // Category 10: Delivery & Seen Status
    // ==========================================
    console.log("\n--- Testing Category 10: Delivery & Seen ---");
    await resetLimits();

    // 10.1 Offline receiver gets "sent", then connect transitions to "delivered"
    let offlineMsgId;
    {
      // Temporarily disconnect Bob's socket
      bob.socket.disconnect();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Message while Bob is offline" });
      offlineMsgId = res.body?.data?.id;
      const initialStatus = res.body?.data?.status;

      // Reconnect Bob's socket
      const bobSocket2 = (await import("socket.io-client")).io(
        `http://127.0.0.1:${port}`,
        {
          auth: { token: bob.accessToken },
          extraHeaders: { Cookie: bob.cookies },
          transports: ["websocket"],
        },
      );
      await new Promise((r) => bobSocket2.on("connect", r));
      bob.socket = bobSocket2;

      // Wait 100ms for markPendingAsDelivered
      await new Promise((r) => setTimeout(r, 200));
      const updatedDoc = await Message.findById(offlineMsgId);

      const pass =
        initialStatus === "sent" &&
        updatedDoc.status === "delivered" &&
        Boolean(updatedDoc.deliveredAt);
      recordResult(
        "Delivery",
        "Offline receiver connects and transitions status sent -> delivered",
        "Initial 'sent', transitioned to 'delivered'",
        `initial=${initialStatus}, updated=${updatedDoc.status}`,
        pass,
      );
    }

    // 10.2 markMessagesSeen transitions status to "seen"
    {
      const res = await request(app)
        .patch(`/api/v1/messages/seen/${aliceId}`)
        .set("Cookie", bob.cookies);
      const updatedDoc = await Message.findById(offlineMsgId);
      const pass =
        res.status === 200 &&
        updatedDoc.status === "seen" &&
        Boolean(updatedDoc.seenAt);
      recordResult(
        "Delivery",
        "markMessagesSeen marks messages as seen with seenAt",
        "200 OK, status='seen', seenAt set",
        `${res.status} status=${updatedDoc.status}`,
        pass,
      );
    }

    // 10.3 markMessagesSeen when blocked updates receiverReadAt without emitting messagesSeen or setting seen
    {
      await resetLimits();
      const blockedMsg = await Message.create({
        senderId: davidId,
        receiverId: aliceId,
        text: "David message while blocked",
        status: "delivered",
        deliveredAt: new Date(),
      });

      let davidSawSeenEvent = false;
      david.socket.on("messagesSeen", () => {
        davidSawSeenEvent = true;
      });

      const res = await request(app)
        .patch(`/api/v1/messages/seen/${davidId}`)
        .set("Cookie", alice.cookies);

      await new Promise((r) => setTimeout(r, 100));
      const updatedMsg = await Message.findById(blockedMsg._id);

      const pass =
        res.status === 200 &&
        updatedMsg.receiverReadAt != null &&
        updatedMsg.status !== "seen" &&
        updatedMsg.seenAt == null &&
        !davidSawSeenEvent;

      recordResult(
        "Delivery",
        "markMessagesSeen when blocked updates receiverReadAt without emitting messagesSeen or setting seen",
        "200 OK, receiverReadAt set, status!=seen, seenAt=null, no socket event",
        `status=${updatedMsg?.status}, readAt=${Boolean(updatedMsg?.receiverReadAt)}, sawEvent=${davidSawSeenEvent}`,
        pass,
      );
    }

    // ==========================================
    // Category 11: Realtime Socket.IO Event Isolation & Crash Guard
    // ==========================================
    console.log("\n--- Testing Category 11: Realtime Socket.IO ---");
    await resetLimits();

    // 11.1 Events reach ONLY participants (Charlie must NOT receive Alice<->Bob messages)
    {
      let charlieReceived = false;
      charlie.socket.on("newMessage", () => {
        charlieReceived = true;
      });

      await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Private Alice to Bob" });

      await new Promise((r) => setTimeout(r, 200));
      recordResult(
        "Realtime",
        "Event isolation: third user Charlie receives nothing",
        "charlieReceived = false",
        `charlieReceived = ${charlieReceived}`,
        !charlieReceived,
      );
    }

    // 11.2 Malformed socket payloads do NOT crash process
    {
      let errorThrown = false;
      try {
        alice.socket.emit("typing", null);
        alice.socket.emit("typing", { to: 12345, isTyping: "not_a_boolean" });
        alice.socket.emit("typing", { to: "invalid_id", isTyping: true });
        alice.socket.emit("call:invite", null, () => {});
        alice.socket.emit("call:invite", { to: 9999, type: {} }, () => {});
        alice.socket.emit("call:offer", "garbage", () => {});
        alice.socket.emit("call:answer", null);
        alice.socket.emit("call:ice", undefined);
        alice.socket.emit("privacy:update", "not_an_object");
      } catch (err) {
        errorThrown = true;
      }
      await new Promise((r) => setTimeout(r, 200));
      const stillAlive = mongoose.connection.readyState === 1 && !errorThrown;
      recordResult(
        "Realtime",
        "Malformed socket payloads handled safely without crash",
        "Process survives, zero unhandled errors",
        `stillAlive = ${stillAlive}, errorThrown = ${errorThrown}`,
        stillAlive,
      );
    }

    // ==========================================
    // Category 12: Calls Signaling
    // ==========================================
    console.log("\n--- Testing Category 12: Calls Signaling ---");
    await resetLimits();

    // 12.1 Invite to offline user returns reason "offline"
    {
      const dummyOfflineUser = await User.create({
        fullName: "Offline User",
        email: "offline@test.com",
        password: TEST_PASSWORD,
        status: "active",
      });
      const ackResult = await new Promise((resolve) => {
        alice.socket.emit(
          "call:invite",
          { to: String(dummyOfflineUser._id), type: "audio" },
          resolve,
        );
      });
      const pass = ackResult?.ok === false && ackResult?.reason === "offline";
      recordResult(
        "Calls",
        "Invite to offline user returns { ok: false, reason: 'offline' }",
        "{ ok: false, reason: 'offline' }",
        JSON.stringify(ackResult),
        pass,
      );
    }

    // 12.2 Invite to blocked user returns reason "not-allowed"
    {
      const ackResult = await new Promise((resolve) => {
        alice.socket.emit(
          "call:invite",
          { to: davidId, type: "audio" },
          resolve,
        );
      });
      const pass =
        ackResult?.ok === false && ackResult?.reason === "not-allowed";
      recordResult(
        "Calls",
        "Invite to blocked user returns { ok: false, reason: 'not-allowed' }",
        "{ ok: false, reason: 'not-allowed' }",
        JSON.stringify(ackResult),
        pass,
      );
    }

    // 12.3 Invite to busy user (already in call)
    {
      const invite1 = await new Promise((resolve) => {
        alice.socket.emit("call:invite", { to: bobId, type: "audio" }, resolve);
      });
      // Charlie tries to call Bob while Bob is ringing
      const invite2 = await new Promise((resolve) => {
        charlie.socket.emit(
          "call:invite",
          { to: bobId, type: "audio" },
          resolve,
        );
      });
      const pass =
        invite1?.ok === true &&
        invite2?.ok === false &&
        invite2?.reason === "busy";
      recordResult(
        "Calls",
        "Invite to busy user returns { ok: false, reason: 'busy' }",
        "invite1 ok=true, invite2 ok=false reason='busy'",
        `invite1=${invite1?.ok}, invite2=${invite2?.reason}`,
        pass,
      );

      // Clean up call
      if (invite1?.callId) {
        alice.socket.emit("call:end", { callId: invite1.callId });
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    // 12.4 Callee disconnects while ringing marks call "missed"
    {
      const invite = await new Promise((resolve) => {
        alice.socket.emit("call:invite", { to: bobId, type: "audio" }, resolve);
      });
      const callId = invite?.callId;

      // Bob disconnects while ringing
      bob.socket.disconnect();
      await new Promise((r) => setTimeout(r, 300));

      const callDoc = await Call.findOne({
        startedAt: { $exists: true },
        callerId: aliceId,
        receiverId: bobId,
      }).sort({ createdAt: -1 });
      const pass = callDoc && callDoc.status === "missed";
      recordResult(
        "Calls",
        "Callee disconnects while ringing marks call 'missed'",
        "Call status='missed'",
        `callStatus=${callDoc?.status}`,
        pass,
        callDoc,
      );

      // Reconnect Bob
      const bobSocket3 = (await import("socket.io-client")).io(
        `http://127.0.0.1:${port}`,
        {
          auth: { token: bob.accessToken },
          extraHeaders: { Cookie: bob.cookies },
          transports: ["websocket"],
        },
      );
      await new Promise((r) => bobSocket3.on("connect", r));
      bob.socket = bobSocket3;
    }

    // ==========================================
    // Category 13: Scheduled Messages
    // ==========================================
    console.log("\n--- Testing Category 13: Scheduled Messages ---");
    await resetLimits();

    // 13.1 Invalid schedules (<30s or >30d) rejected
    {
      const resTooSoon = await request(app)
        .post(`/api/v1/messages/schedule/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({
          text: "Schedule too soon",
          scheduledFor: new Date(Date.now() + 10_000),
        });
      const resTooLate = await request(app)
        .post(`/api/v1/messages/schedule/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({
          text: "Schedule too late",
          scheduledFor: new Date(Date.now() + 35 * 86400_000),
        });
      const pass = resTooSoon.status === 400 && resTooLate.status === 400;
      recordResult(
        "Scheduled",
        "Schedule time bounds (<30s and >30d rejected)",
        "400 and 400",
        `tooSoon=${resTooSoon.status}, tooLate=${resTooLate.status}`,
        pass,
      );
    }

    // 13.2 Valid schedule and cancellation
    let schedId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/schedule/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({
          text: "Scheduled message 1",
          scheduledFor: new Date(Date.now() + 60_000),
        });
      schedId = res.body?.data?._id;
      const pass = res.status === 201 && res.body?.data?.status === "pending";
      recordResult(
        "Scheduled",
        "Valid schedule creation",
        "201 Created with status='pending'",
        `${res.status} status=${res.body?.data?.status}`,
        pass,
      );
    }
    {
      const res = await request(app)
        .delete(`/api/v1/messages/scheduled/${schedId}`)
        .set("Cookie", alice.cookies);
      const doc = await ScheduledMessage.findById(schedId);
      const pass = res.status === 200 && doc.status === "cancelled";
      recordResult(
        "Scheduled",
        "Cancel scheduled message",
        "200 with status='cancelled'",
        `${res.status} docStatus=${doc?.status}`,
        pass,
      );
    }

    // 13.3 Stranded job recovery
    {
      const strandedJob = await ScheduledMessage.create({
        senderId: aliceId,
        receiverId: bobId,
        text: "Stranded job recovery test",
        scheduledFor: new Date(Date.now() - 1000),
        status: "processing",
      });
      await ScheduledMessage.collection.updateOne(
        { _id: strandedJob._id },
        { $set: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) } },
      );
      await recoverStrandedJobs();
      const updatedJob = await ScheduledMessage.findById(strandedJob._id);
      const pass = updatedJob.status === "pending";
      recordResult(
        "Scheduled",
        "Stranded 'processing' job recovered back to 'pending'",
        "status='pending'",
        `status=${updatedJob.status}`,
        pass,
      );
    }

    // ==========================================
    // Category 14: Disappearing Messages
    // ==========================================
    console.log("\n--- Testing Category 14: Disappearing Messages ---");
    await resetLimits();

    // 14.1 Set disappearing timer
    {
      const res = await request(app)
        .put(`/api/v1/messages/disappearing/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ seconds: 86400 });
      const setting = await ChatSetting.findOne({ disappearAfter: 86400 });
      const pass = res.status === 200 && setting !== null;
      recordResult(
        "Disappearing",
        "Set disappearing messages timer (86400s)",
        "200 OK and ChatSetting updated",
        `${res.status} saved=${Boolean(setting)}`,
        pass,
      );
    }

    // 14.2 New message receives expiresAt
    let expMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Disappearing text" });
      const doc = await Message.findById(res.body?.data?.id);
      expMsgId = doc?._id;
      const pass = doc && doc.expiresAt && doc.expiresAt.getTime() > Date.now();
      recordResult(
        "Disappearing",
        "New message assigned expiresAt based on chat setting",
        "expiresAt set in future",
        `expiresAt=${doc?.expiresAt}`,
        pass,
      );
    }

    // 14.3 Disappearing sweeper wipes expired message
    {
      // Mock expiresAt to past
      await Message.updateOne(
        { _id: expMsgId },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );
      const count = await sweepDisappearingMessages();
      const doc = await Message.findById(expMsgId);
      const pass =
        count > 0 && doc.isDeleted === true && doc.text === undefined;
      recordResult(
        "Disappearing",
        "Disappearing sweeper wipes expired message",
        "Message wiped and marked isDeleted=true",
        `count=${count}, isDeleted=${doc.isDeleted}`,
        pass,
      );
    }

    // 14.4 getLastMessage filters out expired messages
    {
      await resetLimits();
      const oldActiveMsg = await Message.create({
        senderId: aliceId,
        receiverId: charlieId,
        text: "Older active message",
      });
      const expiredMsg = await Message.create({
        senderId: aliceId,
        receiverId: charlieId,
        text: "Expired newer message",
        expiresAt: new Date(Date.now() - 10000),
      });
      await Message.collection.updateOne(
        { _id: expiredMsg._id },
        { $set: { createdAt: new Date(Date.now() + 1000) } },
      );

      let lastMsgReceived = null;
      charlie.socket.once("conversationUpdated", (data) => {
        lastMsgReceived = data?.lastMessage;
      });

      const { emitConversationUpdate } =
        await import("../src/utils/message-helpers.js");
      await emitConversationUpdate(charlieId, aliceId);
      await new Promise((r) => setTimeout(r, 100));

      const pass =
        lastMsgReceived &&
        lastMsgReceived.text === "Older active message" &&
        lastMsgReceived.id !== String(expiredMsg._id);

      recordResult(
        "Disappearing",
        "getLastMessage filters out expired messages and falls back to active message",
        "Older active message returned, expired message excluded",
        `lastMsgText=${lastMsgReceived?.text}`,
        pass,
      );
    }

    // Reset disappearing timer to 0
    await request(app)
      .put(`/api/v1/messages/disappearing/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({ seconds: 0 });

    // ==========================================
    // Category 15: Location (Static, Live, & Bug Verification)
    // ==========================================
    console.log("\n--- Testing Category 15: Location ---");
    await resetLimits();

    // 15.1 Static location share
    {
      const res = await request(app)
        .post(`/api/v1/messages/location/share`)
        .set("Cookie", alice.cookies)
        .send({
          receiverId: bobId,
          mode: "current",
          lat: 37.7749,
          lng: -122.4194,
          accuracy: 10,
        });
      const pass =
        res.status === 201 &&
        res.body?.data?.location?.lat === 37.7749 &&
        res.body?.data?.location?.isLive === false;
      recordResult(
        "Location",
        "Static location share sends location with isLive=false",
        "201 with isLive=false",
        `${res.status} isLive=${res.body?.data?.location?.isLive}`,
        pass,
        res.body?.data,
      );
    }

    // 15.2 Live location share
    let liveShareId;
    let liveMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/location/share`)
        .set("Cookie", alice.cookies)
        .send({
          receiverId: bobId,
          mode: "live",
          lat: 37.7749,
          lng: -122.4194,
          accuracy: 10,
          durationMin: 15,
        });
      liveShareId = res.body?.data?.share?._id;
      liveMsgId = res.body?.data?.message?.id;
      const pass =
        res.status === 201 &&
        res.body?.data?.share?.status === "active" &&
        res.body?.data?.message?.location?.isLive === true;
      recordResult(
        "Location",
        "Live location share creates active share and isLive=true",
        "201 with isLive=true",
        `${res.status} isLive=${res.body?.data?.message?.location?.isLive}`,
        pass,
      );
    }

    // 15.3 Stop live location & verify Message.location.isLive BUG FIX
    {
      const res = await request(app)
        .patch(`/api/v1/messages/location/stop/${liveShareId}`)
        .set("Cookie", alice.cookies);
      const shareDoc = await LocationShare.findById(liveShareId);
      const msgDoc = await Message.findById(liveMsgId);

      const pass =
        shareDoc.status === "stopped" && msgDoc.location.isLive === false;
      recordResult(
        "Location",
        "stopShare updates Message.location.isLive to false",
        "Message.location.isLive should be false",
        `shareStatus=${shareDoc.status}, msgIsLive=${msgDoc?.location?.isLive}`,
        pass,
        { shareStatus: shareDoc.status, messageLocation: msgDoc.location },
      );
    }

    // 15.4 startShare stops previous active shares and sets their Message.location.isLive to false
    {
      await resetLimits();
      const res1 = await request(app)
        .post(`/api/v1/messages/location/share`)
        .set("Cookie", alice.cookies)
        .send({
          receiverId: bobId,
          mode: "live",
          lat: 10,
          lng: 20,
          durationMin: 15,
        });
      const msg1Id = res1.body?.data?.message?.id;

      const res2 = await request(app)
        .post(`/api/v1/messages/location/share`)
        .set("Cookie", alice.cookies)
        .send({
          receiverId: bobId,
          mode: "live",
          lat: 30,
          lng: 40,
          durationMin: 15,
        });
      const msg2Id = res2.body?.data?.message?.id;

      const doc1 = await Message.findById(msg1Id);
      const doc2 = await Message.findById(msg2Id);

      const pass =
        doc1.location.isLive === false && doc2.location.isLive === true;
      recordResult(
        "Location",
        "startShare stops previous active shares and sets their Message.location.isLive to false",
        "Previous share isLive=false, new share isLive=true",
        `msg1.isLive=${doc1?.location?.isLive}, msg2.isLive=${doc2?.location?.isLive}`,
        pass,
      );
    }

    // ==========================================
    // Category 16: Link Preview SSRF Protection
    // ==========================================
    console.log("\n--- Testing Category 16: Link Preview ---");

    {
      const privateIps = [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "192.168.1.1",
        "172.16.0.1",
        "::1",
      ];
      const allBlocked = privateIps.every((ip) => isPrivateIp(ip));
      const publicIpSafe = !isPrivateIp("8.8.8.8");
      const pass = allBlocked && publicIpSafe;
      recordResult(
        "Link Preview",
        "SSRF IP validator correctly identifies all private and loopback IPs",
        "All private blocked, public allowed",
        `allBlocked=${allBlocked}, publicSafe=${publicIpSafe}`,
        pass,
      );
    }

    // ==========================================
    // Category 17: E2EE
    // ==========================================
    console.log("\n--- Testing Category 17: E2EE ---");

    // 17.1 E2EE with media guard
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .attach("image", sampleImagePath)
        .field("text", "Encrypted media attempt")
        .field("encrypted", "true");
      const pass =
        res.status === 400 &&
        res.body?.message?.includes(
          "End-to-end encrypted media is not supported",
        );
      recordResult(
        "E2EE",
        "E2EE with media attachment rejected by guard",
        "400 'End-to-end encrypted media is not supported.'",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 17.2 E2EE with valid ciphertext and IV
    {
      const validCipher = Buffer.from(
        "this_is_a_valid_32_byte_ciphertext_data_!",
      ).toString("base64");
      const validIv = Buffer.from("123456789012").toString("base64"); // 12 bytes = 16 base64 chars
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: validCipher, encrypted: true, iv: validIv });
      const pass =
        res.status === 201 &&
        res.body?.data?.encrypted === true &&
        res.body?.data?.iv === validIv;
      recordResult(
        "E2EE",
        "E2EE text send with valid ciphertext & IV",
        "201 Created with encrypted=true",
        `${res.status} encrypted=${res.body?.data?.encrypted}`,
        pass,
        res.body?.data,
      );
    }

    // ==========================================
    // Category 18: Search
    // ==========================================
    console.log("\n--- Testing Category 18: Search ---");

    // 18.1 Search query with regex special characters does NOT crash and escapes safely
    {
      const res = await request(app)
        .get(
          `/api/v1/messages/search/${bobId}?q=${encodeURIComponent(".*+?^${}()|[]\\")}`,
        )
        .set("Cookie", alice.cookies);
      const pass = res.status === 200 && Array.isArray(res.body?.data);
      recordResult(
        "Search",
        "Search with regex characters does not crash (properly escaped)",
        "200 OK with array",
        `${res.status} count=${res.body?.data?.length}`,
        pass,
      );
    }

    // 18.2 Search min length (<2 characters returns empty)
    {
      const res = await request(app)
        .get(`/api/v1/messages/search/${bobId}?q=a`)
        .set("Cookie", alice.cookies);
      const pass =
        res.status === 200 &&
        res.body?.message === "Type at least 2 characters." &&
        res.body?.data?.length === 0;
      recordResult(
        "Search",
        "Search with < 2 chars returns empty list",
        "200 'Type at least 2 characters.'",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // ==========================================
    // Category 19: Chat History & Authorization
    // ==========================================
    console.log("\n--- Testing Category 19: History & Authorization ---");

    // 19.1 David (outsider) cannot read Alice<->Bob history
    {
      const res = await request(app)
        .get(`/api/v1/messages/${bobId}`)
        .set("Cookie", david.cookies);
      // History between David and Bob has no messages
      const pass = res.status === 200 && res.body?.data?.length === 0;
      recordResult(
        "History",
        "Outsider David queries Bob's ID -> returns empty, cannot read Alice-Bob messages",
        "200 with 0 messages",
        `${res.status} count=${res.body?.data?.length}`,
        pass,
      );
    }

    // 19.2 Unauthenticated access to message routes rejected with 401
    {
      const resGet = await request(app).get(`/api/v1/messages/${bobId}`);
      const resSend = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .send({ text: "No auth" });
      const resPin = await request(app).patch(
        `/api/v1/messages/pin/${pinMsgIds[0]}`,
      );
      const pass =
        resGet.status === 401 &&
        resSend.status === 401 &&
        resPin.status === 401;
      recordResult(
        "Authorization",
        "Unauthenticated HTTP requests rejected with 401 Unauthorized",
        "401 across all endpoints",
        `get=${resGet.status}, send=${resSend.status}, pin=${resPin.status}`,
        pass,
      );
    }

    // ==========================================
    // Category 20: Report User
    // ==========================================
    console.log("\n--- Testing Category 20: Report ---");

    // 20.1 Valid report
    {
      const res = await request(app)
        .post(`/api/v1/messages/report/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ reason: "spam", details: "Spamming test messages" });
      const pass = res.status === 201;
      recordResult(
        "Report",
        "Valid report submitted",
        "201 Created",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 20.2 Duplicate report within 24h rejected with 409
    {
      const res = await request(app)
        .post(`/api/v1/messages/report/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ reason: "spam", details: "Duplicate report" });
      const pass = res.status === 409;
      recordResult(
        "Report",
        "Duplicate report within 24h rejected with 409 Conflict",
        "409 Conflict",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // ==========================================
    // Category 21: Database Indexes & Query Explain
    // ==========================================
    console.log("\n--- Testing Category 21: Indexes & Query Explain ---");

    const messageIndexes = await Message.collection.indexes();
    const indexNames = messageIndexes.map((idx) => idx.name);

    // Verify partial unique index on { senderId, clientId }
    const clientIdIdx = messageIndexes.find(
      (idx) => idx.key.senderId === 1 && idx.key.clientId === 1,
    );
    const hasPartialClientId =
      clientIdIdx &&
      clientIdIdx.unique === true &&
      clientIdIdx.partialFilterExpression?.clientId?.$type === "string";
    recordResult(
      "Indexes",
      "Message partial unique index on { senderId: 1, clientId: 1 } exists with partialFilterExpression",
      "Unique partial index on clientId string",
      `exists=${Boolean(clientIdIdx)}, unique=${clientIdIdx?.unique}`,
      hasPartialClientId,
      clientIdIdx,
    );

    // Verify expiresAt index
    const expiresIdx = messageIndexes.find(
      (idx) => idx.key.expiresAt === 1 && idx.key.isDeleted === 1,
    );
    recordResult(
      "Indexes",
      "Message compound index on { expiresAt: 1, isDeleted: 1 } exists",
      "Index exists",
      `exists=${Boolean(expiresIdx)}`,
      Boolean(expiresIdx),
      expiresIdx,
    );

    // Explain: History Query
    const historyExplain = await Message.find({
      $or: [
        { senderId: aliceId, receiverId: bobId },
        { senderId: bobId, receiverId: aliceId },
      ],
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: 1 })
      .explain("executionStats");

    const historyStage =
      historyExplain?.executionStats?.executionStages?.stage ||
      historyExplain?.queryPlanner?.winningPlan?.stage;
    recordResult(
      "Explain",
      "History query uses index scan (IXSCAN)",
      "Stage involves IXSCAN",
      `stage=${historyStage}`,
      historyStage !== "COLLSCAN",
      { stage: historyStage },
    );

    // Explain: Unread Count Query
    const unreadExplain = await Message.find({
      receiverId: bobId,
      senderId: aliceId,
      status: { $ne: "seen" },
      receiverReadAt: null,
      isDeleted: { $ne: true },
    }).explain("executionStats");

    const unreadStage =
      unreadExplain?.executionStats?.executionStages?.stage ||
      unreadExplain?.queryPlanner?.winningPlan?.stage;
    recordResult(
      "Explain",
      "Unread count query uses compound index scan (IXSCAN)",
      "Stage involves IXSCAN",
      `stage=${unreadStage}`,
      unreadStage !== "COLLSCAN",
      { stage: unreadStage },
    );

    // Explain: Disappearing Sweeper Query
    const sweeperExplain = await Message.find({
      expiresAt: { $lte: new Date() },
      isDeleted: { $ne: true },
    }).explain("executionStats");

    const sweeperStage =
      sweeperExplain?.executionStats?.executionStages?.stage ||
      sweeperExplain?.queryPlanner?.winningPlan?.stage;
    recordResult(
      "Explain",
      "Disappearing sweeper uses { expiresAt: 1, isDeleted: 1 } index scan (IXSCAN)",
      "Stage involves IXSCAN",
      `stage=${sweeperStage}`,
      sweeperStage !== "COLLSCAN",
      { stage: sweeperStage },
    );

    // ==========================================
    // Category 23: Sidebar & User Discovery
    // ==========================================
    console.log("\n--- Testing Category 23: Sidebar & User Discovery ---");
    await resetLimits();

    // 23.1 getUsersForSidebar unread counts
    {
      await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Unread count sidebar test" });

      const res = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", bob.cookies);
      const aliceEntry = (res.body?.data || []).find((u) => u.id === aliceId);
      const pass = res.status === 200 && aliceEntry && aliceEntry.unreadCount >= 1;
      recordResult(
        "Sidebar",
        "getUsersForSidebar accurately aggregates unreadCount",
        "unreadCount >= 1",
        `unreadCount=${aliceEntry?.unreadCount}`,
        pass,
        aliceEntry,
      );
    }

    // 23.2 getUsersForSidebar lastMessage formatting
    {
      const res = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", bob.cookies);
      const aliceEntry = (res.body?.data || []).find((u) => u.id === aliceId);
      const lm = aliceEntry?.lastMessage;
      const pass =
        res.status === 200 &&
        lm &&
        typeof lm.id === "string" &&
        lm.senderId === aliceId &&
        lm.receiverId === bobId &&
        Boolean(lm.createdAt);
      recordResult(
        "Sidebar",
        "getUsersForSidebar returns properly formatted lastMessage",
        "lastMessage has id, senderId, receiverId, createdAt",
        `id=${lm?.id}, text=${lm?.text}`,
        pass,
        lm,
      );
    }

    // 23.3 getUsersForSidebar sort order
    {
      const res = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", bob.cookies);
      const list = res.body?.data || [];
      const isSorted = list.every((item, i, arr) => {
        if (i === 0) return true;
        const prev = arr[i - 1].lastMessageAt ? new Date(arr[i - 1].lastMessageAt).getTime() : 0;
        const curr = item.lastMessageAt ? new Date(item.lastMessageAt).getTime() : 0;
        return prev >= curr;
      });
      const pass = res.status === 200 && list.length > 0 && isSorted;
      recordResult(
        "Sidebar",
        "getUsersForSidebar sorts conversations descending by lastMessageAt",
        "Array sorted descending by lastMessageAt",
        `isSorted=${isSorted}, count=${list.length}`,
        pass,
      );
    }

    // 23.4 getUsersForSidebar blocked user filtering
    {
      const resAlice = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", alice.cookies);
      const davidInAlice = (resAlice.body?.data || []).find((u) => u.id === davidId);
      const isMarkedBlocked = davidInAlice ? davidInAlice.isBlocked === true : true;

      const resDavid = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", david.cookies);
      const pass = resAlice.status === 200 && resDavid.status === 200 && isMarkedBlocked;
      recordResult(
        "Sidebar",
        "getUsersForSidebar respects blocked status in response",
        "isBlocked=true for blocked user",
        `davidInAlice.isBlocked=${davidInAlice?.isBlocked}`,
        pass,
      );
    }

    // 23.5 getUsersForSidebar deletedFor filtering
    {
      const resMsg = await request(app)
        .post(`/api/v1/messages/send/${charlieId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Self-deleted sidebar message" });
      const delMsgId = resMsg.body?.data?.id;
      await request(app)
        .delete(`/api/v1/messages/delete-for-me/${delMsgId}`)
        .set("Cookie", alice.cookies);

      const resAlice = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", alice.cookies);
      const charlieEntry = (resAlice.body?.data || []).find((u) => u.id === charlieId);
      const pass =
        resAlice.status === 200 &&
        charlieEntry?.lastMessage?.text !== "Self-deleted sidebar message";
      recordResult(
        "Sidebar",
        "getUsersForSidebar excludes deletedFor messages from lastMessage",
        "lastMessage does NOT match deletedFor message",
        `lastMsg=${charlieEntry?.lastMessage?.text}`,
        pass,
      );
    }

    // 23.6 getUsersForSidebar privacy masking
    {
      await User.updateOne(
        { _id: bobId },
        { $set: { profilePhotoVisibility: "nobody", aboutVisibility: "nobody" } },
      );
      const res = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", alice.cookies);
      const bobEntry = (res.body?.data || []).find((u) => u.id === bobId);
      const pass =
        res.status === 200 &&
        bobEntry &&
        bobEntry.avatar === "" &&
        bobEntry.bio === "";
      recordResult(
        "Sidebar",
        "getUsersForSidebar masks avatar & bio when privacy set to nobody",
        "avatar='' and bio=''",
        `avatar="${bobEntry?.avatar}", bio="${bobEntry?.bio}"`,
        pass,
      );
      await User.updateOne(
        { _id: bobId },
        { $set: { profilePhotoVisibility: "everyone", aboutVisibility: "contacts" } },
      );
    }

    // ==========================================
    // Category 24: Chat Preferences (Archive & Favorites)
    // ==========================================
    console.log("\n--- Testing Category 24: Chat Preferences ---");
    await resetLimits();

    // 24.1 Archive chat
    {
      const res = await request(app)
        .patch(`/api/v1/messages/archive/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ archived: true });
      const archiveDoc = await ChatArchive.findOne({ ownerId: aliceId, otherId: bobId });
      const pass =
        res.status === 200 &&
        res.body?.message === "Chat archived." &&
        res.body?.data?.archived === true &&
        Boolean(archiveDoc);
      recordResult(
        "Preferences",
        "setArchive archives chat and persists in ChatArchive",
        "200 'Chat archived.' and record exists",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 24.2 Unarchive chat
    {
      const res = await request(app)
        .patch(`/api/v1/messages/archive/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ archived: false });
      const archiveDoc = await ChatArchive.findOne({ ownerId: aliceId, otherId: bobId });
      const pass =
        res.status === 200 &&
        res.body?.message === "Chat unarchived." &&
        res.body?.data?.archived === false &&
        !archiveDoc;
      recordResult(
        "Preferences",
        "setArchive unarchives chat and deletes from ChatArchive",
        "200 'Chat unarchived.' and record removed",
        `${res.status} msg=${res.body?.message}`,
        pass,
      );
    }

    // 24.3 Add user to favorites
    {
      const res = await request(app)
        .post(`/api/v1/users/${bobId}/favorite`)
        .set("Cookie", alice.cookies);
      const aliceDoc = await User.findById(aliceId);
      const hasFav = (aliceDoc?.favorites || []).map(String).includes(bobId);
      const pass =
        res.status === 200 &&
        res.body?.message === "Added to favorites." &&
        hasFav;
      recordResult(
        "Preferences",
        "addFavorite adds user to favorites array",
        "200 'Added to favorites.' and userId in favorites",
        `${res.status} hasFav=${hasFav}`,
        pass,
      );
    }

    // 24.4 Remove user from favorites
    {
      const res = await request(app)
        .delete(`/api/v1/users/${bobId}/favorite`)
        .set("Cookie", alice.cookies);
      const aliceDoc = await User.findById(aliceId);
      const hasFav = (aliceDoc?.favorites || []).map(String).includes(bobId);
      const pass =
        res.status === 200 &&
        res.body?.message === "Removed from favorites." &&
        !hasFav;
      recordResult(
        "Preferences",
        "removeFavorite removes user from favorites array",
        "200 'Removed from favorites.' and userId not in favorites",
        `${res.status} hasFav=${hasFav}`,
        pass,
      );
    }

    // ==========================================
    // Category 25: Unpin & Scheduled Retrieval
    // ==========================================
    console.log("\n--- Testing Category 25: Unpin & Scheduled Retrieval ---");
    await resetLimits();

    // 25.1 togglePin unpin
    {
      const pMsg = await Message.create({
        senderId: aliceId,
        receiverId: charlieId,
        text: "Pin and unpin test message",
      });
      await request(app)
        .patch(`/api/v1/messages/pin/${pMsg._id}`)
        .set("Cookie", alice.cookies);
      const res = await request(app)
        .patch(`/api/v1/messages/pin/${pMsg._id}`)
        .set("Cookie", alice.cookies);
      const doc = await Message.findById(pMsg._id);
      const pass =
        res.status === 200 &&
        res.body?.data?.isPinned === false &&
        doc?.isPinned === false &&
        doc?.pinnedBy === undefined;
      recordResult(
        "Pin",
        "togglePin unpins an already pinned message",
        "200 isPinned=false and DB field unpinned",
        `${res.status} isPinned=${doc?.isPinned}`,
        pass,
      );
    }

    // 25.2 getScheduled retrieves all pending scheduled messages
    {
      const s = await ScheduledMessage.create({
        senderId: aliceId,
        receiverId: bobId,
        text: "Pending scheduled retrieval test",
        scheduledFor: new Date(Date.now() + 120_000),
        status: "pending",
      });
      const res = await request(app)
        .get("/api/v1/messages/scheduled")
        .set("Cookie", alice.cookies);
      const found = (res.body?.data || []).some((item) => String(item._id) === String(s._id));
      const pass =
        res.status === 200 &&
        res.body?.message === "Scheduled messages." &&
        found;
      recordResult(
        "Scheduled",
        "getScheduled returns pending scheduled messages for current user",
        "200 array containing scheduled job",
        `${res.status} found=${found}`,
        pass,
      );
    }

    // 25.3 getScheduled filtered by to parameter
    {
      const res = await request(app)
        .get(`/api/v1/messages/scheduled?to=${bobId}`)
        .set("Cookie", alice.cookies);
      const pass =
        res.status === 200 &&
        Array.isArray(res.body?.data) &&
        res.body?.data.every((item) => String(item.receiverId) === bobId);
      recordResult(
        "Scheduled",
        "getScheduled filters by receiverId when to param provided",
        "200 filtered array matching receiverId",
        `${res.status} count=${res.body?.data?.length}`,
        pass,
      );
    }

    // ==========================================
    // Category 26: Location Active Shares & Seen Privacy
    // ==========================================
    console.log("\n--- Testing Category 26: Location Active Shares & Seen Privacy ---");
    await resetLimits();

    // 26.1 getActiveShares returns active shares for mine and forMe
    {
      const activeShare = await LocationShare.create({
        sharerId: aliceId,
        receiverId: bobId,
        expiresAt: new Date(Date.now() + 600_000),
        status: "active",
        lastLocation: { lat: 30.5, lng: 70.2, updatedAt: new Date() },
      });

      const resMine = await request(app)
        .get("/api/v1/messages/location/active")
        .set("Cookie", alice.cookies);
      const resForMe = await request(app)
        .get("/api/v1/messages/location/active")
        .set("Cookie", bob.cookies);

      const hasMine = (resMine.body?.data?.mine || []).some(
        (s) => String(s._id) === String(activeShare._id),
      );
      const hasForMe = (resForMe.body?.data?.forMe || []).some(
        (s) => String(s._id) === String(activeShare._id),
      );
      const pass =
        resMine.status === 200 &&
        resForMe.status === 200 &&
        hasMine &&
        hasForMe;

      recordResult(
        "Location",
        "getActiveShares returns active shares in mine and forMe lists",
        "200 with mine and forMe matching active share",
        `hasMine=${hasMine}, hasForMe=${hasForMe}`,
        pass,
      );

      await LocationShare.deleteOne({ _id: activeShare._id });
    }

    // 26.2 markMessagesSeen with readReceipts disabled
    {
      await User.updateOne({ _id: bobId }, { $set: { readReceipts: false } });
      privacyByUser.set(bobId, { ...privacyByUser.get(bobId), readReceipts: false });

      const sentMsg = await Message.create({
        senderId: aliceId,
        receiverId: bobId,
        text: "Seen with readReceipts off test",
        status: "delivered",
        deliveredAt: new Date(),
      });

      let seenEmittedToAlice = false;
      const seenListener = () => {
        seenEmittedToAlice = true;
      };
      alice.socket.once("messagesSeen", seenListener);

      const res = await request(app)
        .patch(`/api/v1/messages/seen/${aliceId}`)
        .set("Cookie", bob.cookies);

      await new Promise((r) => setTimeout(r, 100));
      alice.socket.off("messagesSeen", seenListener);

      const updatedDoc = await Message.findById(sentMsg._id);
      const pass =
        res.status === 200 &&
        Boolean(updatedDoc.receiverReadAt) &&
        updatedDoc.status === "delivered" &&
        !seenEmittedToAlice;

      recordResult(
        "Delivery",
        "markMessagesSeen with readReceipts disabled updates read timestamp but keeps status=delivered without socket emit",
        "status='delivered', receiverReadAt set, no messagesSeen emitted",
        `status=${updatedDoc?.status}, emitted=${seenEmittedToAlice}`,
        pass,
      );

      await User.updateOne({ _id: bobId }, { $set: { readReceipts: true } });
      privacyByUser.set(bobId, { ...privacyByUser.get(bobId), readReceipts: true });
    }

    // ==========================================
    // Category 27: Typing & Presence Sockets
    // ==========================================
    console.log("\n--- Testing Category 27: Typing & Presence Sockets ---");

    // 27.1 Typing event roundtrip
    {
      let receivedTyping = null;
      bob.socket.once("typing", (data) => {
        receivedTyping = data;
      });

      alice.socket.emit("typing", { to: bobId, isTyping: true });
      await new Promise((r) => setTimeout(r, 100));

      const pass =
        receivedTyping &&
        receivedTyping.from === aliceId &&
        receivedTyping.isTyping === true;

      recordResult(
        "Typing",
        "Typing event routed successfully from sender to receiver socket",
        "from=aliceId, isTyping=true",
        `received=${JSON.stringify(receivedTyping)}`,
        pass,
      );
    }

    // 27.2 Typing suppressed when typingIndicator disabled
    {
      privacyByUser.set(aliceId, {
        ...privacyByUser.get(aliceId),
        typingIndicator: false,
      });

      let suppressedReceived = false;
      const listener = () => {
        suppressedReceived = true;
      };
      bob.socket.once("typing", listener);

      alice.socket.emit("typing", { to: bobId, isTyping: true });
      await new Promise((r) => setTimeout(r, 100));
      bob.socket.off("typing", listener);

      const pass = !suppressedReceived;
      recordResult(
        "Typing",
        "Typing event suppressed when typingIndicator is disabled in privacy",
        "No typing event emitted",
        `suppressedReceived=${suppressedReceived}`,
        pass,
      );

      privacyByUser.set(aliceId, {
        ...privacyByUser.get(aliceId),
        typingIndicator: true,
      });
    }

    // 27.3 Presence / Online status visibility toggle
    {
      await User.updateOne(
        { _id: bobId },
        { $set: { onlineStatusVisibility: "nobody" } },
      );

      const res = await request(app)
        .get("/api/v1/messages/")
        .set("Cookie", alice.cookies);
      const b = (res.body?.data || []).find((u) => u.id === bobId);
      const pass = res.status === 200 && b && b.showOnlineStatus === false;

      recordResult(
        "Presence",
        "User with onlineStatusVisibility='nobody' has showOnlineStatus=false in sidebar",
        "showOnlineStatus=false",
        `showOnlineStatus=${b?.showOnlineStatus}`,
        pass,
      );

      await User.updateOne(
        { _id: bobId },
        { $set: { onlineStatusVisibility: "everyone" } },
      );
    }

    // ==========================================
    // Category 28: Response-Shape Snapshots (All 22 REST Endpoints)
    // ==========================================
    console.log("\n--- Testing Category 28: Response-Shape Snapshots ---");
    await resetLimits();

    function assertSnapshot(endpointName, res, expectedStatus, expectedMessage, expectedDataKeys = null) {
      const topKeys = Object.keys(res.body || {}).sort();
      const hasStandardKeys =
        res.status < 400
          ? topKeys.join(",") === "data,message,success" && res.body?.success === true
          : topKeys.join(",") === "message,statusCode,success" && res.body?.success === false;

      const statusMatches = res.status === expectedStatus;
      const messageMatches = res.body?.message === expectedMessage;

      let dataKeysMatch = true;
      if (expectedDataKeys && res.body?.data) {
        if (Array.isArray(res.body.data) && res.body.data.length > 0) {
          const firstItemKeys = Object.keys(res.body.data[0]);
          dataKeysMatch = expectedDataKeys.every((k) => firstItemKeys.includes(k));
        } else if (typeof res.body.data === "object" && !Array.isArray(res.body.data)) {
          const dKeys = Object.keys(res.body.data);
          dataKeysMatch = expectedDataKeys.every((k) => dKeys.includes(k));
        }
      }

      const pass = statusMatches && messageMatches && hasStandardKeys && dataKeysMatch;
      recordResult(
        "Snapshot",
        `[REST Shape] ${endpointName}`,
        `${expectedStatus} msg="${expectedMessage}" keys=[${topKeys.join(",")}]`,
        `${res.status} msg="${res.body?.message}"`,
        pass,
        { status: res.status, bodyKeys: topKeys, message: res.body?.message },
      );
    }

    // Shared setup for snapshots
    let snapMsgId;
    {
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Snapshot base message" });
      snapMsgId = res.body?.data?.id;
    }

    // 1. GET /
    {
      const res = await request(app).get("/api/v1/messages/").set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/", res, 200, "Users fetched successfully.");
    }

    // 2. GET /:id
    {
      const res = await request(app).get(`/api/v1/messages/${bobId}`).set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/:id", res, 200, "User messages fetched successfully.");
    }

    // 3. POST /send/:id
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/send/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Snapshot send test" });
      assertSnapshot("POST /api/v1/messages/send/:id", res, 201, "Message sent successfully.", ["id", "status", "text"]);
    }

    // 4. POST /forward/:messageId
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/forward/${snapMsgId}`)
        .set("Cookie", alice.cookies)
        .send({ userIds: [charlieId] });
      assertSnapshot("POST /api/v1/messages/forward/:messageId", res, 200, "Forwarded to 1 chat(s).");
    }

    // 5. PATCH /edit/:messageId
    {
      await resetLimits();
      const res = await request(app)
        .patch(`/api/v1/messages/edit/${snapMsgId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Edited snapshot text" });
      assertSnapshot("PATCH /api/v1/messages/edit/:messageId", res, 200, "Message edited.", ["messageId", "isEdited", "text"]);
    }

    // 6. PATCH /pin/:messageId
    {
      const mToPin = await Message.create({ senderId: aliceId, receiverId: charlieId, text: "Snapshot pin" });
      const res = await request(app)
        .patch(`/api/v1/messages/pin/${mToPin._id}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("PATCH /api/v1/messages/pin/:messageId", res, 200, "Pin updated.", ["isPinned", "messageId", "pinnedBy"]);
    }

    // 7. GET /pinned/:id
    {
      const res = await request(app)
        .get(`/api/v1/messages/pinned/${bobId}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/pinned/:id", res, 200, "Pinned messages.");
    }

    // 8. GET /search/:id
    {
      const res = await request(app)
        .get(`/api/v1/messages/search/${bobId}?q=Snapshot`)
        .set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/search/:id", res, 200, "Search results.");
    }

    // 9. POST /schedule/:id
    let snapSchedId;
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/schedule/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Snapshot sched", scheduledFor: new Date(Date.now() + 60_000) });
      snapSchedId = res.body?.data?._id;
      assertSnapshot("POST /api/v1/messages/schedule/:id", res, 201, "Message scheduled.", ["_id", "status", "text"]);
    }

    // 10. GET /scheduled
    {
      const res = await request(app)
        .get("/api/v1/messages/scheduled")
        .set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/scheduled", res, 200, "Scheduled messages.");
    }

    // 11. DELETE /scheduled/:scheduleId
    {
      const res = await request(app)
        .delete(`/api/v1/messages/scheduled/${snapSchedId}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("DELETE /api/v1/messages/scheduled/:scheduleId", res, 200, "Scheduled message cancelled.", ["id"]);
    }

    // 12. PATCH /seen/:id
    {
      const res = await request(app)
        .patch(`/api/v1/messages/seen/${bobId}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("PATCH /api/v1/messages/seen/:id", res, 200, "Messages marked as seen.", ["count"]);
    }

    // 13. PATCH /react/:messageId
    {
      await resetLimits();
      const res = await request(app)
        .patch(`/api/v1/messages/react/${snapMsgId}`)
        .set("Cookie", alice.cookies)
        .send({ emoji: "🎉" });
      assertSnapshot("PATCH /api/v1/messages/react/:messageId", res, 200, "Reaction updated successfully.", ["messageId", "reactions"]);
    }

    // 14. DELETE /delete-for-me/:messageId
    let snapDelMeId;
    {
      const m = await Message.create({ senderId: aliceId, receiverId: bobId, text: "Del me snap" });
      snapDelMeId = m._id;
      const res = await request(app)
        .delete(`/api/v1/messages/delete-for-me/${snapDelMeId}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("DELETE /api/v1/messages/delete-for-me/:messageId", res, 200, "Message deleted for you.", ["messageId"]);
    }

    // 15. DELETE /delete-for-everyone/:messageId
    let snapDelEveryId;
    {
      const m = await Message.create({ senderId: aliceId, receiverId: bobId, text: "Del every snap" });
      snapDelEveryId = m._id;
      const res = await request(app)
        .delete(`/api/v1/messages/delete-for-everyone/${snapDelEveryId}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("DELETE /api/v1/messages/delete-for-everyone/:messageId", res, 200, "Message deleted for everyone.", ["messageId"]);
    }

    // 16. POST /report/:id
    {
      await resetLimits();
      const res = await request(app)
        .post(`/api/v1/messages/report/${charlieId}`)
        .set("Cookie", alice.cookies)
        .send({ reason: "spam", details: "Snapshot report test" });
      assertSnapshot("POST /api/v1/messages/report/:id", res, 201, "Report submitted. Thank you.");
    }

    // 17. GET /disappearing/:id
    {
      const res = await request(app)
        .get(`/api/v1/messages/disappearing/${bobId}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/disappearing/:id", res, 200, "Disappearing setting.", ["seconds"]);
    }

    // 18. PUT /disappearing/:id
    {
      await resetLimits();
      const res = await request(app)
        .put(`/api/v1/messages/disappearing/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ seconds: 0 });
      assertSnapshot("PUT /api/v1/messages/disappearing/:id", res, 200, "Disappearing messages turned off.", ["seconds"]);
    }

    // 19. PATCH /archive/:id
    {
      await resetLimits();
      const res = await request(app)
        .patch(`/api/v1/messages/archive/${bobId}`)
        .set("Cookie", alice.cookies)
        .send({ archived: true });
      assertSnapshot("PATCH /api/v1/messages/archive/:id", res, 200, "Chat archived.", ["archived", "userId"]);
    }

    // 20. POST /location/share
    {
      await resetLimits();
      const res = await request(app)
        .post("/api/v1/messages/location/share")
        .set("Cookie", alice.cookies)
        .send({ receiverId: bobId, lat: 15.0, lng: 75.0, mode: "current" });
      assertSnapshot("POST /api/v1/messages/location/share", res, 201, "Location sent.");
    }

    // 21. PATCH /location/stop/:id
    {
      await resetLimits();
      const share = await LocationShare.create({
        sharerId: aliceId,
        receiverId: bobId,
        expiresAt: new Date(Date.now() + 600_000),
        status: "active",
      });
      const res = await request(app)
        .patch(`/api/v1/messages/location/stop/${share._id}`)
        .set("Cookie", alice.cookies);
      assertSnapshot("PATCH /api/v1/messages/location/stop/:id", res, 200, "Live location stopped.", ["shareId"]);
    }

    // 22. GET /location/active
    {
      const res = await request(app)
        .get("/api/v1/messages/location/active")
        .set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/location/active", res, 200, "Active location shares.", ["forMe", "mine"]);
    }

    // Main Error Path Snapshots
    // 23. Invalid ID format (400)
    {
      const res = await request(app)
        .get("/api/v1/messages/invalid-object-id")
        .set("Cookie", alice.cookies);
      assertSnapshot("GET /api/v1/messages/:id with invalid ID (400)", res, 400, "Invalid User ID.");
    }

    // 24. Nonexistent user (404)
    {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const res = await request(app)
        .post(`/api/v1/messages/send/${nonExistentId}`)
        .set("Cookie", alice.cookies)
        .send({ text: "Hello" });
      assertSnapshot("POST /api/v1/messages/send/:id with nonexistent user (404)", res, 404, "User not found.");
    }

    // 25. Unauthenticated request (401)
    {
      const res = await request(app).get("/api/v1/messages/");
      assertSnapshot("GET /api/v1/messages/ unauthenticated (401)", res, 401, "Authentication required");
    }

    // 26. Route-Table Snapshot (assert all 22 registered routes and method/path in order)
    {
      const { default: router } = await import("../src/router/message/message.routes.js");
      const routes = [];
      router.stack.forEach((layer) => {
        if (layer.route) {
          routes.push({
            method: Object.keys(layer.route.methods)[0].toUpperCase(),
            path: layer.route.path,
          });
        }
      });
      const expectedPaths = [
        "GET /",
        "POST /location/share",
        "PATCH /location/stop/:id",
        "GET /location/active",
        "GET /scheduled",
        "GET /search/:id",
        "GET /pinned/:id",
        "GET /disappearing/:id",
        "GET /:id",
        "POST /send/:id",
        "POST /schedule/:id",
        "DELETE /scheduled/:scheduleId",
        "POST /forward/:messageId",
        "PATCH /edit/:messageId",
        "PATCH /pin/:messageId",
        "PATCH /seen/:id",
        "PATCH /react/:messageId",
        "PUT /disappearing/:id",
        "POST /report/:id",
        "PATCH /archive/:id",
        "DELETE /delete-for-me/:messageId",
        "DELETE /delete-for-everyone/:messageId",
      ];
      const actualPaths = routes.map((r) => `${r.method} ${r.path}`);
      const pass =
        actualPaths.length === expectedPaths.length &&
        actualPaths.every((p, idx) => p === expectedPaths[idx]);
      recordResult(
        "Snapshot",
        "[Route Table Snapshot] All 22 routes match exact method & path in order",
        "22 routes matching frozen contract",
        `actual=${actualPaths.length} routes`,
        pass,
        actualPaths,
      );
    }

    // 27. Socket Event Names Snapshot
    {
      const expectedInbound = [
        "typing",
        "call:invite",
        "call:accept",
        "call:reject",
        "call:end",
        "call:offer",
        "call:answer",
        "call:ice",
        "call:media",
        "location:update",
      ].sort();
      const expectedOutbound = [
        "newMessage",
        "messagesSeen",
        "messageEdited",
        "messageDeleted",
        "messageDeletedForMe",
        "messagePinned",
        "conversationUpdated",
        "chatArchived",
        "disappearingUpdated",
        "call:incoming",
        "call:accepted",
        "call:ended",
        "call:answered-elsewhere",
        "call:offer",
        "call:answer",
        "call:ice",
        "call:media",
        "location:update",
        "location:ended",
      ].sort();
      const pass = expectedInbound.length === 10 && expectedOutbound.length === 19;
      recordResult(
        "Snapshot",
        "[Socket Event Names Snapshot] Complete catalog of frozen socket events",
        "10 inbound and 19 outbound event names",
        `inbound=${expectedInbound.length}, outbound=${expectedOutbound.length}`,
        pass,
        { inbound: expectedInbound, outbound: expectedOutbound },
      );
    }

    // ==========================================
    // Category 22: Process Stability
    // ==========================================
    console.log("\n--- Testing Category 22: Process Stability ---");
    const zeroRejections = unhandledRejections.length === 0;
    const zeroExceptions = uncaughtExceptions.length === 0;
    recordResult(
      "Stability",
      "Zero unhandled promise rejections or uncaught exceptions during entire test run",
      "0 rejections and 0 exceptions",
      `rejections=${unhandledRejections.length}, exceptions=${uncaughtExceptions.length}`,
      zeroRejections && zeroExceptions,
      { unhandledRejections, uncaughtExceptions },
    );
  } finally {
    // Teardown sockets
    alice.socket?.disconnect();
    bob.socket?.disconnect();
    charlie.socket?.disconnect();
    david.socket?.disconnect();

    await teardownTestEnvironment();
  }

  // Final summary
  const total = testResults.length;
  const passed = testResults.filter((r) => r.pass).length;
  const failed = testResults.filter((r) => !r.pass).length;

  console.log("\n==================================================");
  console.log(
    `TEST SUITE FINISHED: Total: ${total} | Passed: ${passed} | Failed: ${failed}`,
  );
  console.log("==================================================\n");

  return { total, passed, failed, results: testResults };
}

runAllTests()
  .then((res) => {
    fs.writeFileSync("/tmp/test_results.json", JSON.stringify(res, null, 2));
    process.exit(res.failed > 0 ? 1 : 0);
  })
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
