import fs from "fs";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import Group from "../src/modules/groups/models/group.model.js";
import Call from "../src/modules/calling/models/call.model.js";
import GroupCall from "../src/modules/calling/models/group-call.model.js";
import User from "../src/modules/users/models/users.model.js";
import Contact from "../src/modules/contacts/models/contact.model.js";
import { socketLimiter } from "../src/infrastructure/socket/socket-rate-limit.js";
import { resetTargetCooldowns } from "../src/modules/calling/signaling/callSignaling.js";

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

async function runCallingTests() {
  console.log("\n==================================================");
  console.log("Starting One-to-One and Group Calling Verification Suite");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie, david, eve } = users;

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
    console.log("--- Category 1: One-to-One Call Initiation & Validations ---");

    await testCase("[1-1 Calling] Self-call rejected", async () => {
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(alice.user._id),
        type: "audio",
      });
      assert(res.ok === false, "Self-call should not be ok");
      assert(res.reason === "invalid", "Reason should be invalid");
    });

    await testCase("[1-1 Calling] Invalid user ID rejected", async () => {
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: "not-an-objectid",
        type: "audio",
      });
      assert(res.ok === false && res.reason === "invalid", "Invalid ID must fail");
    });

    await testCase("[1-1 Calling] Invalid call type rejected", async () => {
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "hologram",
      });
      assert(res.ok === false && res.reason === "invalid", "Invalid type must fail");
    });

    await testCase("[1-1 Calling] Call to offline user returns offline", async () => {
      // Create an offline user
      const offlineUser = await User.create({
        fullName: "Offline User",
        email: "offline@test.com",
        password: "Password123!",
        status: "active",
      });
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(offlineUser._id),
        type: "audio",
      });
      assert(res.ok === false && res.reason === "offline", "Offline user must return offline");
    });

    await testCase("[1-1 Calling] Call to blocked user returns not-allowed", async () => {
      // Alice blocked David in setup
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(david.user._id),
        type: "audio",
      });
      assert(res.ok === false && res.reason === "not-allowed", "Blocked call must fail");

      // David calling Alice should also be blocked
      const resDavid = await emitWithAck(david.socket, "call:invite", {
        to: String(alice.user._id),
        type: "audio",
      });
      assert(resDavid.ok === false && resDavid.reason === "not-allowed", "Blocked call (reverse) must fail");
    });

    await testCase("[1-1 Calling] Call to suspended user returns not-allowed", async () => {
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(eve.user._id),
        type: "audio",
      });
      assert(res.ok === false && res.reason === "not-allowed", "Suspended user call must fail");
    });

    console.log("\n--- Category 2: One-to-One Lifecycle (Invite -> Accept -> WebRTC -> End) ---");

    let activeCallId = null;

    await testCase("[1-1 Calling] Successful audio call invite & incoming event", async () => {
      const incomingPromise = waitForEvent(bob.socket, "call:incoming");

      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });

      assert(res.ok === true && res.callId, "Invite should succeed with callId");
      activeCallId = res.callId;

      const incoming = await incomingPromise;
      assert(incoming.callId === activeCallId, "CallId matches");
      assert(String(incoming.from) === String(alice.user._id), "Caller matches Alice");
      assert(incoming.type === "audio", "Type is audio");
    });

    await testCase("[1-1 Calling] Busy check while call is ringing", async () => {
      // Charlie tries to call Alice while Alice is already in a call
      const res = await emitWithAck(charlie.socket, "call:invite", {
        to: String(alice.user._id),
        type: "audio",
      });
      assert(res.ok === false && res.reason === "busy", "Alice should be busy");

      // Charlie tries to call Bob while Bob is ringing
      const res2 = await emitWithAck(charlie.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      assert(res2.ok === false && res2.reason === "busy", "Bob should be busy");
    });

    await testCase("[1-1 Calling] Accept call & WebRTC signaling", async () => {
      const acceptedPromise = waitForEvent(alice.socket, "call:accepted");

      const acceptRes = await emitWithAck(bob.socket, "call:accept", {
        callId: activeCallId,
      });
      assert(acceptRes.ok === true, "Accept should succeed");

      const accepted = await acceptedPromise;
      assert(accepted.callId === activeCallId, "Alice received call:accepted");

      // Alice sends offer to Bob
      const offerPromise = waitForEvent(bob.socket, "call:offer");
      alice.socket.emit("call:offer", {
        callId: activeCallId,
        offer: { type: "offer", sdp: "v=0\r\no=alice 12345 12345 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n" },
      });
      const receivedOffer = await offerPromise;
      assert(receivedOffer.callId === activeCallId, "Bob received offer");
      assert(receivedOffer.offer.type === "offer", "Valid SDP offer");

      // Bob sends answer to Alice
      const answerPromise = waitForEvent(alice.socket, "call:answer");
      bob.socket.emit("call:answer", {
        callId: activeCallId,
        answer: { type: "answer", sdp: "v=0\r\no=bob 54321 54321 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n" },
      });
      const receivedAnswer = await answerPromise;
      assert(receivedAnswer.callId === activeCallId, "Alice received answer");
      assert(receivedAnswer.answer.type === "answer", "Valid SDP answer");

      // ICE exchange
      const icePromise = waitForEvent(bob.socket, "call:ice");
      alice.socket.emit("call:ice", {
        callId: activeCallId,
        candidate: { candidate: "candidate:1 1 UDP 2122260223 127.0.0.1 50000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
      });
      const receivedIce = await icePromise;
      assert(receivedIce.candidate.candidate.includes("127.0.0.1"), "Bob received ICE candidate");

      // Media toggle
      const mediaPromise = waitForEvent(bob.socket, "call:media");
      alice.socket.emit("call:media", {
        callId: activeCallId,
        audio: false,
        video: false,
      });
      const receivedMedia = await mediaPromise;
      assert(receivedMedia.audio === false, "Bob received audio muted");
    });

    await testCase("[1-1 Calling] Duplicate accept rejected", async () => {
      const res = await emitWithAck(bob.socket, "call:accept", {
        callId: activeCallId,
      });
      assert(res.ok === false, "Duplicate accept must not be ok");
    });

    await testCase("[1-1 Calling] End call persists completed history record", async () => {
      await delay(1100); // 1.1s for non-zero duration

      const aliceEndedPromise = waitForEvent(alice.socket, "call:ended");
      const bobEndedPromise = waitForEvent(bob.socket, "call:ended");

      const endRes = await emitWithAck(alice.socket, "call:end", {
        callId: activeCallId,
      });
      assert(endRes.ok === true, "End call acked");

      const [aliceEnded, bobEnded] = await Promise.all([
        aliceEndedPromise,
        bobEndedPromise,
      ]);

      assert(aliceEnded.status === "completed", "Status is completed");
      assert(bobEnded.status === "completed", "Status is completed");
      assert(aliceEnded.duration >= 1, "Duration calculated >= 1s");

      // Check DB persistence
      const savedCall = await Call.findOne({ callerId: alice.user._id, receiverId: bob.user._id });
      assert(savedCall !== null, "Call record saved to MongoDB");
      assert(savedCall.status === "completed", "DB record status is completed");
      assert(savedCall.duration >= 1, "DB record duration is valid");
      assert(String(savedCall.endedBy) === String(alice.user._id), "endedBy is Alice");
    });

    console.log("\n--- Category 3: Cancellation, Rejection & Multi-Device ---");

    await testCase("[1-1 Calling] Cancel unanswered call -> status cancelled", async () => {
      const incomingPromise = waitForEvent(bob.socket, "call:incoming");

      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "video",
      });
      assert(invite.ok === true, "Invite ok");

      await incomingPromise;

      const bobEndedPromise = waitForEvent(bob.socket, "call:ended");
      const aliceEndedPromise = waitForEvent(alice.socket, "call:ended");

      // Caller cancels before answer
      const endRes = await emitWithAck(alice.socket, "call:end", {
        callId: invite.callId,
      });
      assert(endRes.ok === true, "Cancel acked");

      const [aliceEnded, bobEnded] = await Promise.all([
        aliceEndedPromise,
        bobEndedPromise,
      ]);

      assert(aliceEnded.status === "cancelled", "Cancelled status for caller");
      assert(bobEnded.status === "cancelled", "Cancelled status for callee");
      assert(aliceEnded.duration === 0, "Zero duration for cancelled call");

      const dbCall = await Call.findOne({ callerId: alice.user._id, status: "cancelled" });
      assert(dbCall !== null, "Cancelled record exists in DB");
      assert(dbCall.duration === 0, "Zero duration persisted");
    });

    await testCase("[1-1 Calling] Reject call -> status rejected", async () => {
      const incomingPromise = waitForEvent(charlie.socket, "call:incoming");

      const invite = await emitWithAck(bob.socket, "call:invite", {
        to: String(charlie.user._id),
        type: "audio",
      });
      await incomingPromise;

      const bobEndedPromise = waitForEvent(bob.socket, "call:ended");
      const charlieEndedPromise = waitForEvent(charlie.socket, "call:ended");

      const rejectRes = await emitWithAck(charlie.socket, "call:reject", {
        callId: invite.callId,
      });
      assert(rejectRes.ok === true, "Reject acked");

      const [bEnded, cEnded] = await Promise.all([bobEndedPromise, charlieEndedPromise]);
      assert(bEnded.status === "rejected", "Rejected status for caller");
      assert(cEnded.status === "rejected", "Rejected status for callee");

      const dbCall = await Call.findOne({ callerId: bob.user._id, receiverId: charlie.user._id, status: "rejected" });
      assert(dbCall !== null, "Rejected record exists in DB");
      assert(String(dbCall.endedBy) === String(charlie.user._id), "endedBy is Charlie");
    });

    await testCase("[1-1 Calling] Multi-device callee answers on device 1 -> device 2 receives answered-elsewhere", async () => {
      // Connect second socket for Charlie
      const charlieSocket2 = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: charlie.accessToken },
        extraHeaders: { Cookie: charlie.cookies },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise((res) => charlieSocket2.on("connect", res));

      const inc1Promise = waitForEvent(charlie.socket, "call:incoming");
      const inc2Promise = waitForEvent(charlieSocket2, "call:incoming");

      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(charlie.user._id),
        type: "audio",
      });

      await Promise.all([inc1Promise, inc2Promise]);

      const answeredElsewherePromise = waitForEvent(charlieSocket2, "call:answered-elsewhere");

      // Device 1 answers
      const acceptRes = await emitWithAck(charlie.socket, "call:accept", {
        callId: invite.callId,
      });
      assert(acceptRes.ok === true, "Device 1 accepted");

      const elsewhereEvent = await answeredElsewherePromise;
      assert(elsewhereEvent.callId === invite.callId, "Device 2 received answered-elsewhere");

      // Clean up call
      const cleanEndedPromise1 = waitForEvent(alice.socket, "call:ended");
      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
      await cleanEndedPromise1;
      charlieSocket2.disconnect();
    });

    await testCase("[1-1 Calling] Callee device 2 disconnects while ringing -> device 1 still rings and accepts", async () => {
      const charlieSocket2 = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: charlie.accessToken },
        extraHeaders: { Cookie: charlie.cookies },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise((res) => charlieSocket2.on("connect", res));

      const inc1Promise = waitForEvent(charlie.socket, "call:incoming");
      const inc2Promise = waitForEvent(charlieSocket2, "call:incoming");

      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(charlie.user._id),
        type: "audio",
      });

      await Promise.all([inc1Promise, inc2Promise]);

      // Disconnect device 2 while call is still ringing!
      charlieSocket2.disconnect();
      await delay(200);

      // Device 1 MUST still be able to accept the call!
      const acceptRes = await emitWithAck(charlie.socket, "call:accept", {
        callId: invite.callId,
      });
      assert(acceptRes.ok === true, "Device 1 must be able to accept call despite device 2 disconnect");

      // Clean up call
      const cleanEndedPromise2 = waitForEvent(alice.socket, "call:ended");
      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
      await cleanEndedPromise2;
    });

    await testCase("[1-1 Calling] Accepted call participating socket disconnects -> call finishes immediately even if other socket remains (no zombie)", async () => {
      const charlieSocket2 = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: charlie.accessToken },
        extraHeaders: { Cookie: charlie.cookies },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise((res) => charlieSocket2.on("connect", res));

      const inc1Promise = waitForEvent(charlie.socket, "call:incoming");

      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(charlie.user._id),
        type: "audio",
      });
      await inc1Promise;

      // charlie.socket (Device 1) accepts the call
      const acceptRes = await emitWithAck(charlie.socket, "call:accept", {
        callId: invite.callId,
      });
      assert(acceptRes.ok === true, "Accepted call");

      const endedPromise = waitForEvent(alice.socket, "call:ended");

      // Now charlie.socket (the participating device) disconnects, while charlieSocket2 remains connected
      charlie.socket.disconnect();

      const endedEvent = await endedPromise;
      assert(endedEvent.callId === invite.callId, "Alice received call:ended on participating socket disconnect");
      assert(endedEvent.reason === "disconnected", "Reason was disconnected");

      // Reconnect charlie.socket for later tests
      charlie.socket = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: charlie.accessToken },
        extraHeaders: { Cookie: charlie.cookies },
        transports: ["websocket"],
        reconnection: false,
      });
      await new Promise((res) => charlie.socket.on("connect", res));
      charlieSocket2.disconnect();
    });

    console.log("\n--- Category 4: WebRTC Malformed Payload Handling ---");

    await testCase("[1-1 Security] Malformed SDP and ICE payloads safely discarded without crash", async () => {
      // Setup temporary call
      const incPromise = waitForEvent(bob.socket, "call:incoming");
      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      await incPromise;
      await emitWithAck(bob.socket, "call:accept", { callId: invite.callId });

      // Malformed / oversized SDP
      alice.socket.emit("call:offer", {
        callId: invite.callId,
        offer: { type: "evil_type", sdp: 12345 },
      });

      // Massive SDP attack payload (100KB > 64KB limit)
      alice.socket.emit("call:offer", {
        callId: invite.callId,
        offer: { type: "offer", sdp: "a".repeat(100000) },
      });

      // Malformed ICE candidate
      alice.socket.emit("call:ice", {
        callId: invite.callId,
        candidate: { candidate: "x".repeat(10000) },
      });

      // Null payload
      alice.socket.emit("call:ice", null);
      alice.socket.emit("call:answer", null);

      await delay(200); // Verify server doesn't crash or throw unhandled exceptions

      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
    });

    await testCase("[1-1 Security] WebRTC SDP and ICE candidate payload validation and sanitization (C1, C2)", async () => {
      // Direct validator tests
      const { validateSdp, validateIceCandidate } = await import("../src/modules/calling/signaling/webrtc-validator.js");

      // SDP type matching and rejection of pranswer / rollback
      assert(validateSdp({ type: "offer", sdp: "v=0..." }, "offer") !== null, "Valid offer passes");
      assert(validateSdp({ type: "answer", sdp: "v=0..." }, "offer") === null, "Answer type passed to offer expectation is rejected");
      assert(validateSdp({ type: "offer", sdp: "v=0..." }, "answer") === null, "Offer type passed to answer expectation is rejected");
      assert(validateSdp({ type: "pranswer", sdp: "v=0..." }) === null, "pranswer rejected");
      assert(validateSdp({ type: "rollback", sdp: "v=0..." }) === null, "rollback rejected");
      assert(validateSdp({ type: "offer", sdp: "" }) === null, "empty sdp rejected");
      assert(validateSdp({ type: "offer", sdp: "   " }) === null, "whitespace sdp rejected");

      // ICE candidate: string candidate support
      const strCand = validateIceCandidate("candidate:1 1 UDP 2130706431 192.168.1.1 5000 typ host");
      assert(strCand && strCand.candidate.includes("candidate:1"), "String candidate accepted");

      // ICE candidate: invalid candidate object types
      assert(validateIceCandidate({}) === null, "Empty candidate object {} rejected");
      assert(validateIceCandidate({ candidate: {} }) === null, "candidate object inside candidate rejected");
      assert(validateIceCandidate({ candidate: "c", sdpMLineIndex: -1 }) === null, "Negative sdpMLineIndex rejected");
      assert(validateIceCandidate({ candidate: "c", sdpMLineIndex: 70000 }) === null, "sdpMLineIndex > 65535 rejected");

      // Valid candidate object sanitization (whitelisting only known fields)
      const sanitized = validateIceCandidate({
        candidate: "candidate:foo",
        sdpMid: "audio",
        sdpMLineIndex: 0,
        extraPollution: "malicious",
      });
      assert(sanitized.extraPollution === undefined, "Extra pollution fields stripped");
      assert(sanitized.candidate === "candidate:foo", "Candidate preserved");
    });

    console.log("\n--- Category 5: Group Calling Lifecycle ---");

    // Create a group with Alice, Bob, Charlie
    const groupDoc = await Group.create({
      name: "Engineering Team",
      owner: alice.user._id,
      createdBy: alice.user._id,
      members: [
        { userId: alice.user._id, role: "admin", joinedAt: new Date() },
        { userId: bob.user._id, role: "member", joinedAt: new Date() },
        { userId: charlie.user._id, role: "member", joinedAt: new Date() },
      ],
    });
    const groupId = String(groupDoc._id);

    let activeGCallId = null;

    await testCase("[Group Calling] Non-member cannot start group call", async () => {
      const res = await emitWithAck(david.socket, "gcall:start", {
        groupId,
        type: "audio",
      });
      assert(res.ok === false && res.reason === "not-member", "Non-member cannot start");
    });

    await testCase("[Group Calling] Member starts group call -> members receive incoming event", async () => {
      const bobIncomingPromise = waitForEvent(bob.socket, "gcall:incoming");
      const charlieIncomingPromise = waitForEvent(charlie.socket, "gcall:incoming");

      const res = await emitWithAck(alice.socket, "gcall:start", {
        groupId,
        type: "audio",
      });

      assert(res.ok === true && res.callId, "Group call started ok");
      activeGCallId = res.callId;

      const [bInc, cInc] = await Promise.all([bobIncomingPromise, charlieIncomingPromise]);
      assert(bInc.callId === activeGCallId, "Bob received incoming group call");
      assert(cInc.callId === activeGCallId, "Charlie received incoming group call");
      assert(bInc.groupName === "Engineering Team", "Group name matches");
    });

    await testCase("[Group Calling] Duplicate start returns active", async () => {
      const res = await emitWithAck(bob.socket, "gcall:start", {
        groupId,
        type: "audio",
      });
      assert(res.ok === false && res.reason === "active", "Second start rejected with active");
      assert(res.callId === activeGCallId, "Existing callId returned");
    });

    await testCase("[Group Calling] Non-member cannot join active group call", async () => {
      const res = await emitWithAck(david.socket, "gcall:join", {
        groupId,
      });
      assert(res.ok === false && res.reason === "not-member", "Non-member cannot join");
    });

    await testCase("[Group Calling] Member joins group call & peers receive peer-joined", async () => {
      const alicePeerJoinedPromise = waitForEvent(alice.socket, "gcall:peer-joined");

      const joinRes = await emitWithAck(bob.socket, "gcall:join", {
        groupId,
      });

      assert(joinRes.ok === true, "Bob joined group call");
      assert(joinRes.callId === activeGCallId, "CallId matches");
      assert(Array.isArray(joinRes.peers), "Peers array returned");
      assert(joinRes.peers.some((p) => String(p.userId) === String(alice.user._id)), "Alice in peers");

      const peerJoined = await alicePeerJoinedPromise;
      assert(peerJoined.callId === activeGCallId, "Alice got peer-joined");
      assert(String(peerJoined.userId) === String(bob.user._id), "Bob is the joined peer");
    });

    await testCase("[Group Calling] Signaling and media between participants", async () => {
      const signalPromise = waitForEvent(bob.socket, "gcall:signal");

      alice.socket.emit("gcall:signal", {
        callId: activeGCallId,
        to: String(bob.user._id),
        data: {
          description: { type: "offer", sdp: "v=0\r\no=alice 111 111 IN IP4 127.0.0.1\r\ns=-\r\n" },
        },
      });

      const receivedSignal = await signalPromise;
      assert(receivedSignal.callId === activeGCallId, "Bob received signal");
      assert(receivedSignal.data.description.type === "offer", "SDP offer received");

      const mediaPromise = waitForEvent(bob.socket, "gcall:media");
      alice.socket.emit("gcall:media", {
        callId: activeGCallId,
        audio: true,
        video: false,
      });
      const receivedMedia = await mediaPromise;
      assert(receivedMedia.callId === activeGCallId && receivedMedia.video === false, "Media toggle received");
    });

    await testCase("[Group Calling] Participant leaves -> peer receives peer-left", async () => {
      const alicePeerLeftPromise = waitForEvent(alice.socket, "gcall:peer-left");
      const endedPromise = waitForEvent(alice.socket, "gcall:ended");

      alice.socket.emit("gcall:leave", { callId: activeGCallId });

      const ended = await endedPromise;
      assert(ended.callId === activeGCallId, "Call ended when all leave");

      // Verify group call DB record
      const dbGroupCall = await GroupCall.findOne({ groupId });
      assert(dbGroupCall !== null, "Group call record saved to DB");
      assert(dbGroupCall.status === "completed", "Status is completed");
      assert(dbGroupCall.participants.length >= 2, "Participants recorded");
    });

    console.log("\n--- Category 6: Group Deletion Cascade & Member Eviction ---");

    await testCase("[Group Calling] Deleting group terminates running call in memory", async () => {
      // Start another group call in a temp group
      const tempGroup = await Group.create({
        name: "Temp Call Group",
        owner: alice.user._id,
        createdBy: alice.user._id,
        members: [
          { userId: alice.user._id, role: "admin", joinedAt: new Date() },
          { userId: bob.user._id, role: "member", joinedAt: new Date() },
        ],
      });

      const res = await emitWithAck(alice.socket, "gcall:start", {
        groupId: String(tempGroup._id),
        type: "audio",
      });
      assert(res.ok === true, "Temp group call started");

      const endedPromise = waitForEvent(alice.socket, "gcall:ended");

      // Alice deletes the group via REST API
      const delRes = await request(app)
        .delete(`/api/v1/groups/${tempGroup._id}`)
        .set("Cookie", alice.cookies);
      assert(delRes.status === 200, "Group deleted via API");

      const endedEvent = await endedPromise;
      assert(endedEvent.callId === res.callId, "Running call ended on group deletion");
    });

    await testCase("[Group Calling] Member eviction terminates peer session and drops later signals (C3, D5)", async () => {
      // Temp group for eviction testing
      const evictGroup = await Group.create({
        name: "Eviction Test Group",
        owner: alice.user._id,
        createdBy: alice.user._id,
        members: [
          { userId: alice.user._id, role: "admin", joinedAt: new Date() },
          { userId: bob.user._id, role: "member", joinedAt: new Date() },
        ],
      });
      const evictGid = String(evictGroup._id);

      const gCallRes = await emitWithAck(alice.socket, "gcall:start", {
        groupId: evictGid,
        type: "audio",
      });
      assert(gCallRes.ok === true, "Alice started group call");

      const joinRes = await emitWithAck(bob.socket, "gcall:join", {
        groupId: evictGid,
      });
      assert(joinRes.ok === true, "Bob joined group call");

      const peerLeftPromise = waitForEvent(alice.socket, "gcall:peer-left");

      // Owner Alice removes Bob from group
      const removeRes = await request(app)
        .delete(`/api/v1/groups/${evictGid}/members/${bob.user._id}`)
        .set("Cookie", alice.cookies);
      assert(removeRes.status === 200, "Bob removed from group");

      const peerLeftEvent = await peerLeftPromise;
      assert(String(peerLeftEvent.userId) === String(bob.user._id), "Alice received peer-left for Bob");

      // Bob tries to emit gcall:signal to Alice -> must be dropped
      let aliceGotSignal = false;
      const signalHandler = () => { aliceGotSignal = true; };
      alice.socket.on("gcall:signal", signalHandler);

      bob.socket.emit("gcall:signal", {
        callId: gCallRes.callId,
        to: String(alice.user._id),
        data: { description: { type: "offer", sdp: "v=0..." } },
      });

      await delay(200);
      alice.socket.off("gcall:signal", signalHandler);
      assert(aliceGotSignal === false, "Evicted member signal dropped silently");

      // Clean up call
      alice.socket.emit("gcall:leave", { callId: gCallRes.callId });
      await delay(100);
    });

    console.log("\n--- Category 7: REST API History Endpoints ---");

    await testCase("[Call REST APIs] GET /api/v1/calls/history returns formatted calls and respects pagination", async () => {
      const res = await request(app)
        .get("/api/v1/calls/history?limit=10&page=1")
        .set("Cookie", alice.cookies);

      assert(res.status === 200, "Status 200");
      assert(res.body.success === true, "Success true");
      assert(Array.isArray(res.body.data), "Data is array");
      assert(res.body.data.length > 0, "Contains call history");

      const first = res.body.data[0];
      assert(first.id, "Call has id");
      assert(["incoming", "outgoing"].includes(first.direction), "Valid direction");
      assert(["audio", "video"].includes(first.type), "Valid type");
      assert(typeof first.duration === "number", "Duration is number");
      assert(first.user && first.user.fullName, "Populated other user");
    });

    await testCase("[Call REST APIs] GET /api/v1/calls/history rejects invalid pagination query", async () => {
      const res = await request(app)
        .get("/api/v1/calls/history?limit=-5")
        .set("Cookie", alice.cookies);
      assert(res.status === 400, "Negative limit rejected with 400");
    });

    await testCase("[Call REST APIs] GET /api/v1/group-calls/history returns user group call history", async () => {
      const res = await request(app)
        .get("/api/v1/group-calls/history?limit=10")
        .set("Cookie", alice.cookies);

      assert(res.status === 200, "Status 200");
      assert(Array.isArray(res.body.data), "Data is array");
      assert(res.body.data.length > 0, "Group calls returned");
      const first = res.body.data[0];
      assert(first.id, "Group call has id");
      assert(first.group && first.group.name, "Group object populated");
      assert(Array.isArray(first.participants), "Participants array populated");
    });

    await testCase("[Call REST APIs] GET /api/v1/group-calls/group/:id validates membership and ID", async () => {
      // Valid member Alice
      const resMember = await request(app)
        .get(`/api/v1/group-calls/group/${groupId}`)
        .set("Cookie", alice.cookies);
      assert(resMember.status === 200, "Member gets 200");

      // Non-member David
      const resNonMember = await request(app)
        .get(`/api/v1/group-calls/group/${groupId}`)
        .set("Cookie", david.cookies);
      assert(resNonMember.status === 403, "Non-member rejected with 403");

      // Invalid group ID
      const resInvalid = await request(app)
        .get("/api/v1/group-calls/group/invalid-id")
        .set("Cookie", alice.cookies);
      assert(resInvalid.status === 400, "Invalid group ID rejected with 400");
    });

    await testCase("[Call Privacy] Avatar masking and email protection across nobody, contacts-only, everyone, and blocked (B1, B4)", async () => {
      // Setup privacy scenarios:
      // User 1: nobody
      const userNobody = await User.create({
        fullName: "User Nobody",
        email: `nobody_${Date.now()}@test.com`,
        password: "password123",
        avatar: { url: "https://res.cloudinary.com/test/nobody.jpg" },
        profilePhotoVisibility: "nobody",
      });

      // User 2: contacts-only, has Alice in contacts
      const userContactsWithAlice = await User.create({
        fullName: "User Contacts Saved",
        email: `contacts_saved_${Date.now()}@test.com`,
        password: "password123",
        avatar: { url: "https://res.cloudinary.com/test/contacts_saved.jpg" },
        profilePhotoVisibility: "contacts",
      });
      await Contact.create({ ownerId: userContactsWithAlice._id, contactId: alice.user._id });

      // User 3: contacts-only, does NOT have Alice in contacts
      const userContactsNotSaved = await User.create({
        fullName: "User Contacts Not Saved",
        email: `contacts_notsaved_${Date.now()}@test.com`,
        password: "password123",
        avatar: { url: "https://res.cloudinary.com/test/contacts_not.jpg" },
        profilePhotoVisibility: "contacts",
      });

      // User 4: everyone
      const userEveryone = await User.create({
        fullName: "User Everyone",
        email: `everyone_${Date.now()}@test.com`,
        password: "password123",
        avatar: { url: "https://res.cloudinary.com/test/everyone.jpg" },
        profilePhotoVisibility: "everyone",
      });

      // User 5: blocked (user blocked Alice)
      const userBlocked = await User.create({
        fullName: "User Blocked",
        email: `blocked_${Date.now()}@test.com`,
        password: "password123",
        avatar: { url: "https://res.cloudinary.com/test/blocked.jpg" },
        profilePhotoVisibility: "everyone",
        blockedUsers: [alice.user._id],
      });

      // Create test call records for each
      const { createCallRecord } = await import("../src/modules/calling/services/call.service.js");
      await Promise.all([
        createCallRecord({ callerId: alice.user._id, receiverId: userNobody._id, type: "audio", status: "completed", duration: 10 }),
        createCallRecord({ callerId: alice.user._id, receiverId: userContactsWithAlice._id, type: "audio", status: "completed", duration: 10 }),
        createCallRecord({ callerId: alice.user._id, receiverId: userContactsNotSaved._id, type: "audio", status: "completed", duration: 10 }),
        createCallRecord({ callerId: alice.user._id, receiverId: userEveryone._id, type: "audio", status: "completed", duration: 10 }),
        createCallRecord({ callerId: alice.user._id, receiverId: userBlocked._id, type: "audio", status: "completed", duration: 10 }),
      ]);

      const res = await request(app)
        .get("/api/v1/calls/history?limit=20")
        .set("Cookie", alice.cookies);

      assert(res.status === 200, "History 200");
      const calls = res.body.data;

      // Email MUST NOT be exposed on any user in call history
      for (const c of calls) {
        assert(c.user && c.user.email === undefined, "Email must NEVER be exposed in call history");
      }

      const nobodyCall = calls.find(c => String(c.user?.id) === String(userNobody._id));
      assert(nobodyCall && nobodyCall.user.avatar === "", "nobody visibility -> avatar masked to empty string");

      const savedCall = calls.find(c => String(c.user?.id) === String(userContactsWithAlice._id));
      assert(savedCall && savedCall.user.avatar === "https://res.cloudinary.com/test/contacts_saved.jpg", "contacts saved -> avatar visible");

      const notSavedCall = calls.find(c => String(c.user?.id) === String(userContactsNotSaved._id));
      assert(notSavedCall && notSavedCall.user.avatar === "", "contacts not saved -> avatar masked to empty string");

      const everyoneCall = calls.find(c => String(c.user?.id) === String(userEveryone._id));
      assert(everyoneCall && everyoneCall.user.avatar === "https://res.cloudinary.com/test/everyone.jpg", "everyone visibility -> avatar visible");

      const blockedCall = calls.find(c => String(c.user?.id) === String(userBlocked._id));
      assert(blockedCall && blockedCall.user.avatar === "", "blocked user -> avatar masked to empty string");
    });

    console.log("\n--- Category 8: Temp File Cleanup on Multipart Failure (U1) ---");

    await testCase("[Temp File Cleanup] POST /api/v1/auth/register cleans up temp file on registration validation failure", async () => {
      fs.mkdirSync("public/upload", { recursive: true });
      const initialUploadFiles = fs.readdirSync("public/upload");
      const tmpFile = `/tmp/test_reg_avatar_${Date.now()}.png`;
      fs.writeFileSync(tmpFile, "fake-reg-avatar-bytes");

      // Send registration request with missing password/invalid email to force failure
      const res = await request(app)
        .post("/api/v1/auth/register")
        .attach("avatar", tmpFile)
        .field("fullName", "Test User")
        .field("email", "invalid-email");

      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      assert(res.status >= 400, `Expected failure >= 400, got ${res.status}`);

      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );
      assert(!leakedFile, `Leaked file found: ${leakedFile}`);
    });

    await testCase("[Temp File Cleanup] PATCH /api/v1/users/profile/avatar cleans up temp file on failure", async () => {
      fs.mkdirSync("public/upload", { recursive: true });
      const initialUploadFiles = fs.readdirSync("public/upload");
      const tmpFile = `/tmp/test_user_avatar_${Date.now()}.png`;
      fs.writeFileSync(tmpFile, "fake-user-avatar-bytes");

      // Request without auth or with invalid token to force failure
      const res = await request(app)
        .patch("/api/v1/users/profile/avatar")
        .attach("avatar", tmpFile);

      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      assert(res.status >= 400, `Expected failure >= 400, got ${res.status}`);

      const postUploadFiles = fs.readdirSync("public/upload");
      const leakedFile = postUploadFiles.find(
        (f) => !initialUploadFiles.includes(f),
      );
      assert(!leakedFile, `Leaked file found: ${leakedFile}`);
    });

    console.log("\n--- Category 9: Concurrency, Busy State Machine & Timer Cleanup (C4, E2, E3) ---");

    await testCase("[Concurrency & State Machine] Concurrent accept + end + timeout race produces exactly ONE Call history document", async () => {
      const startTime = new Date(Date.now() - 1000);
      const incPromise = waitForEvent(bob.socket, "call:incoming");

      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      assert(invite.ok === true, "Invite ok");
      await incPromise;

      // Fire accept, end, and an extra end simultaneously
      await Promise.allSettled([
        emitWithAck(bob.socket, "call:accept", { callId: invite.callId }),
        emitWithAck(alice.socket, "call:end", { callId: invite.callId }),
        emitWithAck(bob.socket, "call:end", { callId: invite.callId }),
      ]);

      await delay(500); // Wait for DB write to settle

      const docs = await Call.find({
        callId: invite.callId,
      });

      assert(docs.length === 1, `Expected exactly 1 Call document in DB, found ${docs.length}`);
    });

    await testCase("[Busy State] User cannot be in a 1-to-1 call and a group call at the same time (busy both ways)", async () => {
      // Alice is in a group call
      const gCallRes = await emitWithAck(alice.socket, "gcall:start", {
        groupId,
        type: "audio",
      });
      assert(gCallRes.ok === true, "Alice started group call");

      // Bob tries to 1-to-1 call Alice while Alice is in group call
      const inviteRes = await emitWithAck(bob.socket, "call:invite", {
        to: String(alice.user._id),
        type: "audio",
      });
      assert(inviteRes.ok === false && inviteRes.reason === "busy", "Alice is busy with group call");

      // Alice tries to 1-to-1 call Bob while in group call
      const inviteRes2 = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      assert(inviteRes2.ok === false && inviteRes2.reason === "busy", "Alice cannot call while in group call");

      // Alice leaves group call
      alice.socket.emit("gcall:leave", { callId: gCallRes.callId });
      await delay(200);
    });

    console.log("\n--- Category 10: Calling Security & Authorization Hardening ---");

    await testCase("[Security] Non-participant cannot end, accept, or tamper with another call", async () => {
      // Alice calls Bob
      const incPromise = waitForEvent(bob.socket, "call:incoming");
      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      assert(invite.ok === true, "Invite ok");
      await incPromise;

      // Charlie (non-participant) tries to accept Alice & Bob's call
      const charlieAccept = await emitWithAck(charlie.socket, "call:accept", {
        callId: invite.callId,
      });
      assert(charlieAccept.ok === false, "Charlie cannot accept Alice's call");

      // Charlie tries to end Alice & Bob's call
      const charlieEnd = await emitWithAck(charlie.socket, "call:end", {
        callId: invite.callId,
      });
      assert(charlieEnd.ok === false, "Charlie cannot end Alice's call");

      // Charlie tries to cancel Alice & Bob's call
      const charlieCancel = await emitWithAck(charlie.socket, "call:cancel", {
        callId: invite.callId,
      });
      assert(charlieCancel.ok === false, "Charlie cannot cancel Alice's call");

      // Clean up call properly by Alice cancelling
      await emitWithAck(alice.socket, "call:cancel", { callId: invite.callId });
      await delay(200);
    });

    await testCase("[Security] Non-participant cannot inject WebRTC signaling or ICE candidates", async () => {
      // Alice calls Bob and Bob accepts
      const incPromise = waitForEvent(bob.socket, "call:incoming");
      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      assert(invite.ok === true, "Invite ok");
      await incPromise;

      const accPromise = waitForEvent(alice.socket, "call:accepted");
      await emitWithAck(bob.socket, "call:accept", { callId: invite.callId });
      await accPromise;

      // Charlie tries to inject SDP offer into Alice & Bob's call
      let bobGotTamperedOffer = false;
      const tamperedOfferListener = () => {
        bobGotTamperedOffer = true;
      };
      bob.socket.on("call:offer", tamperedOfferListener);

      charlie.socket.emit("call:offer", {
        callId: invite.callId,
        offer: {
          type: "offer",
          sdp: "v=0\r\no=- 123 456 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
        },
      });
      await delay(200);
      bob.socket.off("call:offer", tamperedOfferListener);
      assert(!bobGotTamperedOffer, "Charlie's injected offer must NOT reach Bob");

      // Charlie tries to inject ICE candidate into Alice & Bob's call
      let bobGotTamperedIce = false;
      const tamperedIceListener = () => {
        bobGotTamperedIce = true;
      };
      bob.socket.on("call:ice", tamperedIceListener);

      charlie.socket.emit("call:ice", {
        callId: invite.callId,
        candidate: {
          candidate: "candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });
      await delay(200);
      bob.socket.off("call:ice", tamperedIceListener);
      assert(!bobGotTamperedIce, "Charlie's injected ICE candidate must NOT reach Bob");

      // Charlie tries to hold Alice & Bob's call
      const charlieHold = await emitWithAck(charlie.socket, "call:hold", {
        callId: invite.callId,
      });
      assert(charlieHold.ok === false, "Charlie cannot hold Alice's call");

      // Clean up call
      const cleanEndedPromise2 = waitForEvent(alice.socket, "call:ended");
      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
      await cleanEndedPromise2;
      await delay(200);
    });

    await testCase("[Security] Oversized SDP (>64KB) is rejected", async () => {
      const incPromise = waitForEvent(bob.socket, "call:incoming");
      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      await incPromise;
      await emitWithAck(bob.socket, "call:accept", { callId: invite.callId });

      let bobGotOversizedOffer = false;
      const offerListener = () => {
        bobGotOversizedOffer = true;
      };
      bob.socket.on("call:offer", offerListener);

      // Create >65KB SDP string
      const hugeSdp = "v=0\r\n" + "a=candidate:".repeat(6000);
      alice.socket.emit("call:offer", {
        callId: invite.callId,
        offer: { type: "offer", sdp: hugeSdp },
      });
      await delay(200);
      bob.socket.off("call:offer", offerListener);
      assert(!bobGotOversizedOffer, "Oversized SDP must be dropped by server validator");

      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
      await delay(200);
    });

    await testCase("[Security] Malformed or oversized ICE candidate is rejected", async () => {
      const incPromise = waitForEvent(bob.socket, "call:incoming");
      const invite = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      await incPromise;
      await emitWithAck(bob.socket, "call:accept", { callId: invite.callId });

      let bobGotBadIce = false;
      const iceListener = () => {
        bobGotBadIce = true;
      };
      bob.socket.on("call:ice", iceListener);

      // Oversized candidate (>4KB)
      alice.socket.emit("call:ice", {
        callId: invite.callId,
        candidate: {
          candidate: "candidate:".repeat(500),
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });
      // Malformed candidate (empty object)
      alice.socket.emit("call:ice", {
        callId: invite.callId,
        candidate: {},
      });
      // Negative sdpMLineIndex
      alice.socket.emit("call:ice", {
        callId: invite.callId,
        candidate: { candidate: "cand", sdpMid: "0", sdpMLineIndex: -5 },
      });

      await delay(200);
      bob.socket.off("call:ice", iceListener);
      assert(!bobGotBadIce, "Malformed/oversized ICE candidates must be dropped");

      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
      await delay(200);
    });

    await testCase("[Security & Privacy] Call History soft deletion isolation and IDOR protection", async () => {
      // Create a test call record directly between Alice and Bob
      const { createCallRecord } = await import("../src/modules/calling/services/call.service.js");
      const testCall = await createCallRecord({
        callerId: alice.user._id,
        receiverId: bob.user._id,
        type: "audio",
        status: "completed",
        duration: 45,
      });

      // Charlie tries to delete Alice & Bob's call record (IDOR)
      const charlieDelRes = await request(app)
        .delete(`/api/v1/calls/${testCall._id}`)
        .set("Cookie", charlie.cookies);
      assert(charlieDelRes.status === 404, `Charlie IDOR attempt should return 404, got ${charlieDelRes.status}`);

      // Alice deletes the call record
      const aliceDelRes = await request(app)
        .delete(`/api/v1/calls/${testCall._id}`)
        .set("Cookie", alice.cookies);
      assert(aliceDelRes.status === 200, `Alice delete call record should return 200, got ${aliceDelRes.status}`);

      // Alice fetches history -> call should NOT be in Alice's history
      const aliceHistory = await request(app)
        .get("/api/v1/calls/history")
        .set("Cookie", alice.cookies);
      const inAlice = aliceHistory.body.data?.some(c => String(c.id || c._id) === String(testCall._id));
      assert(!inAlice, "Call record should be excluded from Alice's history");

      // Bob fetches history -> call MUST STILL be in Bob's history (soft deletion isolation)
      const bobHistory = await request(app)
        .get("/api/v1/calls/history")
        .set("Cookie", bob.cookies);
      const inBob = bobHistory.body.data?.some(c => String(c.id || c._id) === String(testCall._id));
      assert(inBob, "Call record MUST remain in Bob's history when Alice deleted it");
    });

    await testCase("[Security] ICE servers endpoint returns structured config without leaking secrets", async () => {
      const res = await request(app)
        .get("/api/v1/calls/ice-servers")
        .set("Cookie", alice.cookies);

      assert(res.status === 200, "ICE servers 200 OK");
      assert(res.body.success === true, "Response success");
      assert(Array.isArray(res.body.data?.iceServers), "iceServers is an array");
      assert(typeof res.body.data?.turnOperational === "boolean", "turnOperational boolean present");
      // Verify no secret leak
      const rawString = JSON.stringify(res.body);
      assert(!rawString.includes("TURN_SECRET"), "TURN_SECRET must not leak");
    });

    await testCase("[Security] Caller anti-spam cooldown prevents flooding same target", async () => {
      resetTargetCooldowns();
      for (let i = 0; i < 4; i++) {
        socketLimiter.reset(String(alice.user._id));
        const res = await emitWithAck(alice.socket, "call:invite", {
          to: String(charlie.user._id),
          type: "audio",
        });
        if (res.callId) {
          await emitWithAck(alice.socket, "call:cancel", { callId: res.callId });
        }
        await delay(50);
      }

      // The 5th attempt within 20s must be throttled by target cooldown even if token bucket has tokens
      socketLimiter.reset(String(alice.user._id));
      const floodRes = await emitWithAck(alice.socket, "call:invite", {
        to: String(charlie.user._id),
        type: "audio",
      });
      assert(floodRes.ok === false && floodRes.reason === "rate_limited", "Anti-spam cooldown must reject 5th invite within 20s");
      resetTargetCooldowns();
    });

    console.log("\n--- Category 11: Call Hold / Resume Synchronization & Authority ---");

    let syncCallId = null;

    await testCase("[Hold / Resume] Scenario A: User A (caller) puts call on HOLD -> BOTH participants receive call:held and call:state", async () => {
      // Step 1: Alice calls Bob, Bob accepts
      const bobIncomingPromise = waitForEvent(bob.socket, "call:incoming");
      const inviteRes = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      assert(inviteRes.ok === true && inviteRes.callId, "Alice invite succeeds");
      syncCallId = inviteRes.callId;

      await bobIncomingPromise;
      const acceptRes = await emitWithAck(bob.socket, "call:accept", { callId: syncCallId });
      assert(acceptRes.ok === true, "Bob accept succeeds");
      await delay(100);

      // Step 2: Prepare listeners for BOTH participants
      const aliceHeldPromise = waitForEvent(alice.socket, "call:held");
      const bobHeldPromise = waitForEvent(bob.socket, "call:held");
      const aliceStatePromise = waitForEvent(alice.socket, "call:state");
      const bobStatePromise = waitForEvent(bob.socket, "call:state");

      // Step 3: Alice holds the call
      const holdRes = await emitWithAck(alice.socket, "call:hold", { callId: syncCallId });
      assert(holdRes.ok === true, "Alice hold request ack is ok");
      assert(holdRes.isHeld === true, "Ack indicates isHeld=true");
      assert(String(holdRes.heldBy) === String(alice.user._id), "Ack indicates heldBy Alice");
      assert(holdRes.state === "held", "Ack state is held");
      assert(holdRes.stateVersion >= 2, "Ack stateVersion incremented");

      // Step 4: Verify BOTH participants received synchronous events
      const [aliceHeld, bobHeld, aliceState, bobState] = await Promise.all([
        aliceHeldPromise,
        bobHeldPromise,
        aliceStatePromise,
        bobStatePromise,
      ]);

      assert(aliceHeld.callId === syncCallId, "Alice received call:held");
      assert(String(aliceHeld.heldBy) === String(alice.user._id), "Alice held payload indicates Alice");
      assert(aliceHeld.isHeld === true, "Alice held payload isHeld=true");

      assert(bobHeld.callId === syncCallId, "Bob received call:held");
      assert(String(bobHeld.heldBy) === String(alice.user._id), "Bob held payload indicates Alice");
      assert(bobHeld.isHeld === true, "Bob held payload isHeld=true");

      assert(aliceState.state === "held" && aliceState.isHeld === true, "Alice call:state indicates held");
      assert(bobState.state === "held" && bobState.isHeld === true, "Bob call:state indicates held");
      assert(String(bobState.heldBy) === String(alice.user._id), "Bob call:state indicates heldBy Alice");
    });

    await testCase("[Hold / Resume] Scenario A: User A (caller) RESUMES call -> BOTH participants receive call:resumed and call:state", async () => {
      // Step 1: Prepare listeners for BOTH participants
      const aliceResumedPromise = waitForEvent(alice.socket, "call:resumed");
      const bobResumedPromise = waitForEvent(bob.socket, "call:resumed");
      const aliceStatePromise = waitForEvent(alice.socket, "call:state");
      const bobStatePromise = waitForEvent(bob.socket, "call:state");

      // Step 2: Alice resumes call
      const resumeRes = await emitWithAck(alice.socket, "call:resume", { callId: syncCallId });
      assert(resumeRes.ok === true, "Alice resume request ack is ok");
      assert(resumeRes.isHeld === false, "Ack indicates isHeld=false");
      assert(resumeRes.heldBy === null, "Ack indicates heldBy is null");
      assert(resumeRes.state === "active", "Ack state is active");
      assert(resumeRes.stateVersion >= 3, "Ack stateVersion incremented");

      // Step 3: Verify BOTH participants received synchronous resume events
      const [aliceResumed, bobResumed, aliceState, bobState] = await Promise.all([
        aliceResumedPromise,
        bobResumedPromise,
        aliceStatePromise,
        bobStatePromise,
      ]);

      assert(aliceResumed.callId === syncCallId, "Alice received call:resumed");
      assert(String(aliceResumed.resumedBy) === String(alice.user._id), "Alice resumed payload indicates Alice");
      assert(aliceResumed.isHeld === false, "Alice resumed payload isHeld=false");

      assert(bobResumed.callId === syncCallId, "Bob received call:resumed");
      assert(String(bobResumed.resumedBy) === String(alice.user._id), "Bob resumed payload indicates Alice");
      assert(bobResumed.isHeld === false, "Bob resumed payload isHeld=false");

      assert(aliceState.state === "active" && aliceState.isHeld === false, "Alice call:state indicates active");
      assert(bobState.state === "active" && bobState.isHeld === false, "Bob call:state indicates active");
      assert(bobState.heldBy === null, "Bob call:state indicates heldBy is null");
    });

    await testCase("[Hold / Resume] Scenario C: User B (callee) puts call on HOLD and RESUMES -> symmetric synchronization", async () => {
      // Bob holds
      const aliceHeldPromise = waitForEvent(alice.socket, "call:held");
      const bobHeldPromise = waitForEvent(bob.socket, "call:held");

      const bobHoldRes = await emitWithAck(bob.socket, "call:hold", { callId: syncCallId });
      assert(bobHoldRes.ok === true && bobHoldRes.isHeld === true, "Bob hold succeeds");
      assert(String(bobHoldRes.heldBy) === String(bob.user._id), "Bob hold ack heldBy Bob");

      const [aliceHeld, bobHeld] = await Promise.all([aliceHeldPromise, bobHeldPromise]);
      assert(String(aliceHeld.heldBy) === String(bob.user._id), "Alice received Bob's hold event");
      assert(String(bobHeld.heldBy) === String(bob.user._id), "Bob received own hold event");

      // Bob resumes
      const aliceResumePromise = waitForEvent(alice.socket, "call:resumed");
      const bobResumePromise = waitForEvent(bob.socket, "call:resumed");

      const bobResumeRes = await emitWithAck(bob.socket, "call:resume", { callId: syncCallId });
      assert(bobResumeRes.ok === true && bobResumeRes.isHeld === false, "Bob resume succeeds");

      const [aliceResumed, bobResumed] = await Promise.all([aliceResumePromise, bobResumePromise]);
      assert(String(aliceResumed.resumedBy) === String(bob.user._id), "Alice received Bob's resume event");
      assert(String(bobResumed.resumedBy) === String(bob.user._id), "Bob received own resume event");
    });

    await testCase("[Hold / Resume] Idempotency: Duplicate hold/resume requests return idempotent success without state corruption", async () => {
      // Alice holds
      await emitWithAck(alice.socket, "call:hold", { callId: syncCallId });

      // Duplicate hold request
      const dupHoldRes = await emitWithAck(alice.socket, "call:hold", { callId: syncCallId });
      assert(dupHoldRes.ok === true, "Duplicate hold returns ok=true");
      assert(dupHoldRes.reason === "already-held", "Reason is already-held");
      assert(dupHoldRes.isHeld === true, "isHeld remains true");

      // Alice resumes
      await emitWithAck(alice.socket, "call:resume", { callId: syncCallId });

      // Duplicate resume request
      const dupResumeRes = await emitWithAck(alice.socket, "call:resume", { callId: syncCallId });
      assert(dupResumeRes.ok === true, "Duplicate resume returns ok=true");
      assert(dupResumeRes.reason === "already-active", "Reason is already-active");
      assert(dupResumeRes.isHeld === false, "isHeld remains false");
    });

    await testCase("[Hold / Resume] Security: Non-participant (David) cannot hold or resume Alice & Bob's call", async () => {
      const unauthorizedHold = await emitWithAck(david.socket, "call:hold", { callId: syncCallId });
      assert(unauthorizedHold.ok === false, "David hold rejected");
      assert(unauthorizedHold.reason === "not-participant", "Reason is not-participant");

      const unauthorizedResume = await emitWithAck(david.socket, "call:resume", { callId: syncCallId });
      assert(unauthorizedResume.ok === false, "David resume rejected");
      assert(unauthorizedResume.reason === "not-participant", "Reason is not-participant");
    });

    await testCase("[Hold / Resume] Reconnection: call:get-state returns authoritative state and durations", async () => {
      // Put call on hold
      await emitWithAck(alice.socket, "call:hold", { callId: syncCallId });
      await delay(100);

      // Bob queries state (simulating reconnect)
      const getStateRes1 = await emitWithAck(bob.socket, "call:get-state", { callId: syncCallId });
      assert(getStateRes1.ok === true, "call:get-state succeeds");
      assert(getStateRes1.callState.isHeld === true, "Authoritative isHeld=true");
      assert(String(getStateRes1.callState.heldBy) === String(alice.user._id), "Authoritative heldBy Alice");
      assert(getStateRes1.callState.state === "held", "Authoritative state=held");
      assert(typeof getStateRes1.callState.activeDurationSec === "number", "activeDurationSec provided");
      assert(typeof getStateRes1.callState.totalHoldDurationSec === "number", "totalHoldDurationSec provided");

      // Resume call
      await emitWithAck(alice.socket, "call:resume", { callId: syncCallId });
      await delay(100);

      // Bob queries state again
      const getStateRes2 = await emitWithAck(bob.socket, "call:get-state", { callId: syncCallId });
      assert(getStateRes2.ok === true, "call:get-state succeeds after resume");
      assert(getStateRes2.callState.isHeld === false, "Authoritative isHeld=false");
      assert(getStateRes2.callState.heldBy === null, "Authoritative heldBy=null");
      assert(getStateRes2.callState.state === "active", "Authoritative state=active");
    });

    await testCase("[Hold / Resume] Database persistence: Call record preserves activeDuration, holdDuration, and holdCycles", async () => {
      // End the call
      await emitWithAck(alice.socket, "call:end", { callId: syncCallId });
      await delay(200);

      // Fetch from DB
      const Call = (await import("../src/modules/calling/models/call.model.js")).default;
      const savedCall = await Call.findOne({ callId: syncCallId }).lean();
      assert(savedCall, "Call record found in DB");
      assert(savedCall.status === "completed", "Status is completed");
      assert(typeof savedCall.activeDuration === "number", "activeDuration persisted");
      assert(typeof savedCall.holdDuration === "number", "holdDuration persisted");
      assert(typeof savedCall.holdCycles === "number" && savedCall.holdCycles >= 1, "holdCycles persisted >= 1");

      // Verify cannot hold/resume already ended call
      const lateHold = await emitWithAck(alice.socket, "call:hold", { callId: syncCallId });
      assert(lateHold.ok === false, "Cannot hold ended call");
      assert(
        lateHold.reason === "already-ended" ||
        lateHold.reason === "invalid-state" ||
        lateHold.reason === "not-found",
        "Ended call hold error reason"
      );

      const lateResume = await emitWithAck(alice.socket, "call:resume", { callId: syncCallId });
      assert(lateResume.ok === false, "Cannot resume ended call");
      assert(
        lateResume.reason === "already-ended" ||
        lateResume.reason === "invalid-state" ||
        lateResume.reason === "not-found",
        "Ended call resume error reason"
      );
    });

    console.log("\n--- Category 12: Hold Owner Authorization & Resume Permission Control ---");

    let authCallId = null;

    await testCase("[Hold Authorization] Setup: Alice calls Bob and connects active call", async () => {
      resetTargetCooldowns();
      const bobIncomingPromise = waitForEvent(bob.socket, "call:incoming");
      const inviteRes = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "audio",
      });
      assert(inviteRes.ok === true && inviteRes.callId, "Alice invite succeeds");
      authCallId = inviteRes.callId;

      await bobIncomingPromise;
      const acceptRes = await emitWithAck(bob.socket, "call:accept", { callId: authCallId });
      assert(acceptRes.ok === true, "Bob accept succeeds");
      await delay(100);
    });

    await testCase("[Hold Authorization] User A holds call -> holdOwnerId is set to Alice and synchronized to both participants", async () => {
      const aliceHeldPromise = waitForEvent(alice.socket, "call:held");
      const bobHeldPromise = waitForEvent(bob.socket, "call:held");

      const holdRes = await emitWithAck(alice.socket, "call:hold", { callId: authCallId });
      assert(holdRes.ok === true, "Alice hold succeeds");
      assert(holdRes.isHeld === true, "Ack indicates isHeld=true");
      assert(String(holdRes.holdOwnerId) === String(alice.user._id), "Ack holdOwnerId is Alice");
      assert(String(holdRes.heldBy) === String(alice.user._id), "Ack heldBy is Alice");

      const [aliceHeld, bobHeld] = await Promise.all([aliceHeldPromise, bobHeldPromise]);
      assert(String(aliceHeld.holdOwnerId) === String(alice.user._id), "Alice event holdOwnerId is Alice");
      assert(String(bobHeld.holdOwnerId) === String(alice.user._id), "Bob event holdOwnerId is Alice");
      assert(bobHeld.isHeld === true, "Bob event isHeld is true");
    });

    await testCase("[Hold Authorization] User B cannot resume User A's hold -> rejected with HOLD_OWNER_ONLY and message", async () => {
      const resumeRes = await emitWithAck(bob.socket, "call:resume", { callId: authCallId });
      assert(resumeRes.ok === false, "User B resume rejected");
      assert(resumeRes.reason === "HOLD_OWNER_ONLY", "Reason is HOLD_OWNER_ONLY");
      assert(
        resumeRes.message === "Only the participant who placed this call on hold can resume it.",
        "Error message matches required specification"
      );
      assert(String(resumeRes.holdOwnerId) === String(alice.user._id), "Rejection specifies current holdOwnerId");
    });

    await testCase("[Hold Authorization] Unauthorized resume attempt leaves call state unchanged", async () => {
      let resumedEmitted = false;
      const onResumed = () => { resumedEmitted = true; };
      alice.socket.on("call:resumed", onResumed);
      bob.socket.on("call:resumed", onResumed);

      const resumeRes = await emitWithAck(bob.socket, "call:resume", { callId: authCallId });
      assert(resumeRes.ok === false, "Bob resume fails");
      await delay(150);

      alice.socket.off("call:resumed", onResumed);
      bob.socket.off("call:resumed", onResumed);

      assert(resumedEmitted === false, "call:resumed was NOT emitted on unauthorized attempt");

      // Verify state still held
      const stateRes = await emitWithAck(bob.socket, "call:get-state", { callId: authCallId });
      assert(stateRes.ok === true, "call:get-state succeeds");
      assert(stateRes.callState.isHeld === true, "Call remains held");
      assert(String(stateRes.callState.holdOwnerId) === String(alice.user._id), "holdOwnerId still Alice");
    });

    await testCase("[Hold Authorization] Backend ignores forged holdOwnerId in client payload -> strictly enforces socket user ID", async () => {
      // Bob attempts to spoof by passing holdOwnerId: bob._id
      const spoofedResume = await emitWithAck(bob.socket, "call:resume", {
        callId: authCallId,
        holdOwnerId: String(bob.user._id),
        heldBy: String(bob.user._id),
      });
      assert(spoofedResume.ok === false, "Spoofed resume rejected");
      assert(spoofedResume.reason === "HOLD_OWNER_ONLY", "Reason remains HOLD_OWNER_ONLY");
    });

    await testCase("[Hold Authorization] Non-participant (David) cannot resume call", async () => {
      const davidResume = await emitWithAck(david.socket, "call:resume", { callId: authCallId });
      assert(davidResume.ok === false, "David resume rejected");
      assert(davidResume.reason === "not-participant", "Reason is not-participant");
    });

    await testCase("[Hold Authorization] Authorized Hold Owner (User A) successfully resumes call", async () => {
      const aliceResumedPromise = waitForEvent(alice.socket, "call:resumed");
      const bobResumedPromise = waitForEvent(bob.socket, "call:resumed");

      const resumeRes = await emitWithAck(alice.socket, "call:resume", { callId: authCallId });
      assert(resumeRes.ok === true, "Alice resume succeeds");
      assert(resumeRes.state === "active", "State is active");
      assert(resumeRes.isHeld === false, "isHeld is false");
      assert(resumeRes.holdOwnerId === null, "holdOwnerId cleared to null");

      const [aliceResumed, bobResumed] = await Promise.all([aliceResumedPromise, bobResumedPromise]);
      assert(aliceResumed.isHeld === false, "Alice event isHeld=false");
      assert(bobResumed.isHeld === false, "Bob event isHeld=false");
      assert(String(aliceResumed.resumedBy) === String(alice.user._id), "resumedBy is Alice");
    });

    await testCase("[Hold Authorization] Reverse scenario: User B holds call -> User A cannot resume (HOLD_OWNER_ONLY)", async () => {
      const holdRes = await emitWithAck(bob.socket, "call:hold", { callId: authCallId });
      assert(holdRes.ok === true, "Bob hold succeeds");
      assert(String(holdRes.holdOwnerId) === String(bob.user._id), "holdOwnerId is Bob");

      // Alice tries to resume -> rejected
      const aliceResume = await emitWithAck(alice.socket, "call:resume", { callId: authCallId });
      assert(aliceResume.ok === false, "Alice resume rejected");
      assert(aliceResume.reason === "HOLD_OWNER_ONLY", "Reason is HOLD_OWNER_ONLY");
      assert(String(aliceResume.holdOwnerId) === String(bob.user._id), "holdOwnerId is Bob");
    });

    await testCase("[Hold Authorization] Reverse scenario: User B successfully resumes their own hold", async () => {
      const resumeRes = await emitWithAck(bob.socket, "call:resume", { callId: authCallId });
      assert(resumeRes.ok === true, "Bob resume succeeds");
      assert(resumeRes.state === "active", "State is active");
      assert(resumeRes.holdOwnerId === null, "holdOwnerId cleared");
    });

    await testCase("[Hold Authorization] Reconnection / State Query: authoritative holdOwnerId returned in call:get-state", async () => {
      // Bob puts on hold
      await emitWithAck(bob.socket, "call:hold", { callId: authCallId });
      await delay(100);

      // Alice queries state
      const stateRes = await emitWithAck(alice.socket, "call:get-state", { callId: authCallId });
      assert(stateRes.ok === true, "get-state succeeds");
      assert(stateRes.callState.isHeld === true, "isHeld is true");
      assert(String(stateRes.callState.holdOwnerId) === String(bob.user._id), "holdOwnerId is Bob");
      assert(
        typeof stateRes.callState.holdStartedAt === "string" ||
        typeof stateRes.callState.holdStartedAt === "number",
        "holdStartedAt timestamp/string provided"
      );
      assert(!isNaN(new Date(stateRes.callState.holdStartedAt).getTime()), "holdStartedAt is valid date/timestamp");
      assert(typeof stateRes.callState.holdStateVersion === "number", "holdStateVersion provided");

      // Bob resumes
      await emitWithAck(bob.socket, "call:resume", { callId: authCallId });
      await delay(100);
    });

    await testCase("[Hold Authorization] Multi-Device: Device 2 of User A can resume User A's hold", async () => {
      // Connect second socket for Alice
      const aliceDevice2 = ioClient(`http://127.0.0.1:${port}`, {
        auth: { token: alice.accessToken },
        extraHeaders: { Cookie: alice.cookies },
        transports: ["websocket"],
        reconnection: false,
      });

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timeout connecting aliceDevice2")), 4000);
        aliceDevice2.on("connect", () => { clearTimeout(timer); resolve(); });
        aliceDevice2.on("connect_error", (err) => { clearTimeout(timer); reject(err); });
      });

      try {
        // Alice Device 1 holds call
        const holdRes = await emitWithAck(alice.socket, "call:hold", { callId: authCallId });
        assert(holdRes.ok === true, "Alice Device 1 hold succeeds");
        assert(String(holdRes.holdOwnerId) === String(alice.user._id), "holdOwnerId is Alice");

        // Alice Device 2 resumes call
        const resumeRes = await emitWithAck(aliceDevice2, "call:resume", { callId: authCallId });
        assert(resumeRes.ok === true, "Alice Device 2 resume succeeds because user identity matches hold owner");
        assert(resumeRes.state === "active", "State transitioned to active");
        assert(resumeRes.holdOwnerId === null, "holdOwnerId cleared");
      } finally {
        aliceDevice2.disconnect();
      }
    });

    await testCase("[Hold Authorization] Call termination clears hold ownership and persists metrics to DB", async () => {
      // Alice puts call on hold again before ending
      await emitWithAck(alice.socket, "call:hold", { callId: authCallId });
      await delay(100);

      // End call
      const endRes = await emitWithAck(alice.socket, "call:end", { callId: authCallId });
      assert(endRes.ok === true, "Alice end succeeds");
      await delay(200);

      // Verify DB record
      const Call = (await import("../src/modules/calling/models/call.model.js")).default;
      const callDoc = await Call.findOne({ callId: authCallId }).lean();
      assert(callDoc, "Call found in DB");
      assert(callDoc.status === "completed", "Status is completed");
      assert(callDoc.holdCycles >= 3, "holdCycles recorded >= 3");
      assert(typeof callDoc.holdDuration === "number", "holdDuration recorded");
      assert(typeof callDoc.activeDuration === "number", "activeDuration recorded");

      // Verify cannot resume terminated call
      const lateResume = await emitWithAck(alice.socket, "call:resume", { callId: authCallId });
      assert(lateResume.ok === false, "Cannot resume terminated call");
    });

    console.log("\n==================================================");
    console.log(`CALLING TEST SUITE: Total: ${totalTests} | Passed: ${passedTests} | Failed: 0`);
    console.log("==================================================\n");

  } finally {
    // Disconnect user sockets
    for (const s of Object.values(users.allSessions)) {
      if (s?.socket?.connected) {
        s.socket.disconnect();
      }
    }
    await teardownTestEnvironment();
  }
}

runCallingTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
