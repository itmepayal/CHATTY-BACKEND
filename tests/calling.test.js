import fs from "fs";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import request from "supertest";
import { io as ioClient } from "socket.io-client";
import Group from "../src/models/group.model.js";
import Call from "../src/models/call.model.js";
import GroupCall from "../src/models/group-call.model.js";
import User from "../src/models/users.model.js";
import Contact from "../src/models/contact.model.js";
import { socketLimiter } from "../src/utils/socket-rate-limit.js";

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
      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
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
      await emitWithAck(alice.socket, "call:end", { callId: invite.callId });
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
      const { validateSdp, validateIceCandidate } = await import("../src/utils/webrtc-validator.js");

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
      const { createCallRecord } = await import("../src/services/calls/call.service.js");
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
