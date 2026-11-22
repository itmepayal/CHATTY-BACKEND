import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import request from "supertest";
import Group from "../src/modules/groups/models/group.model.js";
import Call from "../src/modules/calling/models/call.model.js";
import GroupCall from "../src/modules/calling/models/group-call.model.js";
import { socketLimiter } from "../src/infrastructure/socket/socket-rate-limit.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEvent(socket, eventName, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeoutMs);

    socket.once(eventName, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function emitWithAck(socket, event, data, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ack on: ${event}`));
    }, timeoutMs);

    socket.emit(event, data, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function runVideoCallingTests() {
  console.log("\n==================================================");
  console.log("Starting Advanced Video Calling Verification Suite");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie } = users;

  let totalTests = 0;
  let passedTests = 0;

  async function testCase(name, fn) {
    totalTests++;
    try {
      socketLimiter.resetAll();
      await fn();
      passedTests++;
      console.log(`[✓ PASS] ${name}`);
    } catch (err) {
      console.error(`[✗ FAIL] ${name}`);
      console.error(err);
      throw err;
    }
  }

  try {
    console.log("--- Category 1: 1:1 Video Calling & Screen Sharing ---");

    let activeCallId = null;

    await testCase("[1:1 Video] Alice initiates HD video call to Bob", async () => {
      const incomingPromise = waitForEvent(bob.socket, "call:incoming");

      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "video",
      });

      assert(res.ok === true, "Call invite should succeed");
      assert(res.callId, "CallId should be returned");
      activeCallId = res.callId;

      const incoming = await incomingPromise;
      assert(incoming.callId === activeCallId, "Incoming callId matches");
      assert(incoming.type === "video", "Call type must be video");
      assert(String(incoming.from) === String(alice.user._id), "Caller is Alice");
    });

    await testCase("[1:1 Video] Bob accepts video call", async () => {
      const acceptedPromise = waitForEvent(alice.socket, "call:accepted");

      const res = await emitWithAck(bob.socket, "call:accept", {
        callId: activeCallId,
      });

      assert(res.ok === true, "Accept should succeed");

      const accepted = await acceptedPromise;
      assert(accepted.callId === activeCallId, "Accepted event matches callId");
    });

    await testCase("[1:1 Video] Alice starts screen sharing, Bob receives notification", async () => {
      const screensharePromise = waitForEvent(bob.socket, "call:screenshare");

      alice.socket.emit("call:screenshare", {
        callId: activeCallId,
        isSharing: true,
      });

      const event = await screensharePromise;
      assert(event.callId === activeCallId, "Screenshare event matches callId");
      assert(event.isSharing === true, "isSharing should be true");
      assert(String(event.userId) === String(alice.user._id), "Sharer is Alice");
    });

    await testCase("[1:1 Video] Alice stops screen sharing", async () => {
      const screensharePromise = waitForEvent(bob.socket, "call:screenshare");

      alice.socket.emit("call:screenshare", {
        callId: activeCallId,
        isSharing: false,
      });

      const event = await screensharePromise;
      assert(event.isSharing === false, "isSharing should be false");
    });

    console.log("\n--- Category 2: Live Emoji Reactions & Captions ---");

    await testCase("[1:1 Reactions] Alice sends emoji reaction to Bob", async () => {
      const reactionPromise = waitForEvent(bob.socket, "call:reaction");

      alice.socket.emit("call:reaction", {
        callId: activeCallId,
        reaction: "🔥",
      });

      const event = await reactionPromise;
      assert(event.reaction === "🔥", "Reaction should match");
      assert(String(event.senderId) === String(alice.user._id), "Sender is Alice");
    });

    await testCase("[1:1 Reactions] Invalid reaction rejected gracefully", async () => {
      let received = false;
      const listener = () => { received = true; };
      bob.socket.once("call:reaction", listener);

      alice.socket.emit("call:reaction", {
        callId: activeCallId,
        reaction: "invalid-custom-script-tag",
      });

      await delay(200);
      bob.socket.off("call:reaction", listener);
      assert(received === false, "Invalid reaction should not be relayed");
    });

    await testCase("[1:1 Captions] Bob sends live caption subtitle to Alice", async () => {
      const captionPromise = waitForEvent(alice.socket, "call:caption");

      bob.socket.emit("call:caption", {
        callId: activeCallId,
        text: "Hello, this is a real-time subtitle",
        language: "en-US",
      });

      const event = await captionPromise;
      assert(event.text === "Hello, this is a real-time subtitle", "Caption text matches");
      assert(String(event.senderId) === String(bob.user._id), "Sender is Bob");
    });

    await testCase("[1:1 End] Alice ends the 1:1 video call", async () => {
      const endedPromise = waitForEvent(bob.socket, "call:ended");

      const res = await emitWithAck(alice.socket, "call:end", {
        callId: activeCallId,
      });

      assert(res.ok === true, "End call should succeed");
      await endedPromise;
    });

    console.log("\n--- Category 3: Translation REST API Endpoint ---");

    await testCase("[Translation API] Translate English caption to Hindi & Spanish", async () => {
      const res = await request(app)
        .post("/api/v1/calls/translate")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .send({
          text: "hello world",
          targetLang: "hi",
          sourceLang: "en",
        });

      assert(res.status === 200, `Translation request should succeed with 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert(res.body.success === true, "Success should be true");
      assert(res.body.data.translatedText, "Translated text must be present");
      assert(res.body.data.targetLang === "hi", "Target lang matches");
    });

    await testCase("[Translation API] Unauthorized request rejected", async () => {
      const res = await request(app)
        .post("/api/v1/calls/translate")
        .send({
          text: "hello",
          targetLang: "es",
        });

      assert(res.status === 401, "Missing token should return 401 Unauthorized");
    });

    console.log("\n--- Category 4: Group Video Calling & Host Controls ---");

    // Create a test group with Alice (admin), Bob, and Charlie
    const testGroup = await Group.create({
      name: "Video Call Test Group",
      owner: alice.user._id,
      createdBy: alice.user._id,
      members: [
        { userId: alice.user._id, role: "admin", joinedAt: new Date() },
        { userId: bob.user._id, role: "member", joinedAt: new Date() },
        { userId: charlie.user._id, role: "member", joinedAt: new Date() },
      ],
    });

    let groupCallId = null;

    await testCase("[Group Video] Alice (Admin) starts a group video call", async () => {
      const res = await emitWithAck(alice.socket, "gcall:start", {
        groupId: String(testGroup._id),
        type: "video",
      });

      assert(res.ok === true, "Start group video call should succeed");
      assert(res.callId, "CallId should be returned");
      groupCallId = res.callId;
    });

    await testCase("[Group Video] Bob joins the group video call", async () => {
      const res = await emitWithAck(bob.socket, "gcall:join", {
        groupId: String(testGroup._id),
      });

      assert(res.ok === true, "Bob should successfully join call");
      assert(res.peers.length >= 1, "Peers list should contain Alice");
    });

    await testCase("[Group Video] Charlie joins the group video call", async () => {
      const res = await emitWithAck(charlie.socket, "gcall:join", {
        groupId: String(testGroup._id),
      });

      assert(res.ok === true, "Charlie should successfully join call");
    });

    await testCase("[Group Video] Bob broadcasts screen sharing to the group", async () => {
      const screensharePromise = waitForEvent(alice.socket, "gcall:screenshare");

      bob.socket.emit("gcall:screenshare", {
        callId: groupCallId,
        isSharing: true,
      });

      const event = await screensharePromise;
      assert(event.isSharing === true, "Screen sharing is active");
      assert(String(event.userId) === String(bob.user._id), "Sharing user is Bob");
    });

    await testCase("[Group Video] Charlie broadcasts group reaction", async () => {
      const reactionPromise = waitForEvent(alice.socket, "gcall:reaction");

      charlie.socket.emit("gcall:reaction", {
        callId: groupCallId,
        reaction: "🎉",
      });

      const event = await reactionPromise;
      assert(event.reaction === "🎉", "Group reaction matches");
      assert(String(event.senderId) === String(charlie.user._id), "Sender is Charlie");
    });

    await testCase("[Group Video] Charlie broadcasts group caption", async () => {
      const captionPromise = waitForEvent(alice.socket, "gcall:caption");

      charlie.socket.emit("gcall:caption", {
        callId: groupCallId,
        text: "Presentation starting now",
      });

      const event = await captionPromise;
      assert(event.text === "Presentation starting now", "Group caption text matches");
    });

    await testCase("[Host Controls] Non-host (Bob) cannot kick Charlie", async () => {
      const res = await emitWithAck(bob.socket, "gcall:kick", {
        callId: groupCallId,
        targetUserId: String(charlie.user._id),
      });

      assert(res.ok === false, "Non-host kick should fail");
      assert(res.reason === "unauthorized", "Reason must be unauthorized");
    });

    await testCase("[Host Controls] Host (Alice) requests Bob to mute", async () => {
      const muteRequestPromise = waitForEvent(bob.socket, "gcall:mute-peer");

      const res = await emitWithAck(alice.socket, "gcall:mute-peer", {
        callId: groupCallId,
        targetUserId: String(bob.user._id),
      });

      assert(res.ok === true, "Mute request by host should succeed");
      const event = await muteRequestPromise;
      assert(event.callId === groupCallId, "CallId matches");
    });

    await testCase("[Host Controls] Host (Alice) kicks Charlie from call", async () => {
      const kickedPromise = waitForEvent(charlie.socket, "gcall:kick");
      const memberLeftPromise = waitForEvent(alice.socket, "gcall:peer-left");

      const res = await emitWithAck(alice.socket, "gcall:kick", {
        callId: groupCallId,
        targetUserId: String(charlie.user._id),
      });

      assert(res.ok === true, "Host kick should succeed");

      const kickedEvent = await kickedPromise;
      assert(String(kickedEvent.kickedBy) === String(alice.user._id), "Kicked by Alice");

      const leftEvent = await memberLeftPromise;
      assert(String(leftEvent.userId) === String(charlie.user._id), "Charlie left event fired");
    });

    await testCase("[Group Video] Alice leaves and ends call", async () => {
      const endedPromise = waitForEvent(bob.socket, "gcall:ended");
      alice.socket.emit("gcall:leave", {
        callId: groupCallId,
      });

      const ended = await endedPromise;
      assert(ended.callId === groupCallId, "Call ended broadcast received");
    });

    console.log(`\n==================================================`);
    console.log(`All ${passedTests}/${totalTests} Video Calling Tests Passed!`);
    console.log(`==================================================\n`);

  } finally {
    alice.socket.disconnect();
    bob.socket.disconnect();
    charlie.socket.disconnect();
    await teardownTestEnvironment(env);
  }
}

runVideoCallingTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
