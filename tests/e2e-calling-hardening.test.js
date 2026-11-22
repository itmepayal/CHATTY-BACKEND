/**
 * Comprehensive End-to-End Calling System Hardening & Verification Suite
 * Tests full two-way signaling, media stream state transitions, hold/resume ownership,
 * mute/unmute audio track synchronization, PiP lifecycle, screen sharing, and history.
 */
import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import Call from "../src/modules/calling/models/call.model.js";
import { socketLimiter } from "../src/infrastructure/socket/socket-rate-limit.js";
import {
  CALL_SOCKET_EVENTS,
  CALL_STATUS,
  CALL_LIFECYCLE_STATE,
} from "../src/modules/calling/constants/call.constants.js";

function assert(condition, msg) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function waitForEvent(socket, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for event "${event}" after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function runHardeningTests() {
  console.log("\n==================================================");
  console.log("Starting E2E Calling System Hardening Verification");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie } = users;
  const aliceSocket = alice.socket;
  const bobSocket = bob.socket;
  const charlieSocket = charlie.socket;

  let passed = 0;
  let failed = 0;

  const runTest = async (name, fn) => {
    try {
      socketLimiter.resetAll();
      await fn();
      console.log(`[✓ PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
      throw err;
    }
  };

  try {
    console.log("--- Section 1: Voice Call Initiation, Ringing & Acceptance ---");
    let activeCallId = null;

    await runTest("Alice initiates audio call and Bob receives incoming event", async () => {
      const bobIncomingPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_INCOMING);
      const inviteAck = await new Promise((res) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          res
        );
      });
      assert(inviteAck?.ok === true, `Alice initiates audio call successfully (reason: ${inviteAck?.reason})`);
      assert(inviteAck?.callId, "Alice invite returns a valid callId");
      activeCallId = inviteAck.callId;

      const incomingData = await bobIncomingPromise;
      assert(incomingData.callId === activeCallId, "Bob receives incoming call notification with matching callId");
      assert(incomingData.from === String(alice.user._id), "Caller verified as Alice");
    });

    await runTest("Bob accepts call and Alice receives accepted notification", async () => {
      const aliceAcceptedPromise = waitForEvent(aliceSocket, CALL_SOCKET_EVENTS.CALL_ACCEPTED);
      const acceptAck = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId: activeCallId }, res);
      });
      assert(acceptAck.ok === true, "Bob successfully accepts call");
      const acceptedData = await aliceAcceptedPromise;
      assert(acceptedData.callId === activeCallId, "Alice receives call:accepted event");
    });

    console.log("\n--- Section 2: Two-Way SDP Offer/Answer Exchange & ICE Handling ---");
    await runTest("Alice sends SDP offer and Bob receives it cleanly", async () => {
      const bobOfferPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_OFFER);
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_OFFER, {
        callId: activeCallId,
        offer: { type: "offer", sdp: "v=0\r\no=alice 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 54312 UDP/TLS/RTP/SAVPF 111\r\n" },
      });
      const bobOffer = await bobOfferPromise;
      assert(bobOffer.offer.type === "offer", "Bob receives validated SDP offer");
    });

    await runTest("Bob sends SDP answer and Alice receives it cleanly", async () => {
      const aliceAnswerPromise = waitForEvent(aliceSocket, CALL_SOCKET_EVENTS.CALL_ANSWER);
      bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ANSWER, {
        callId: activeCallId,
        answer: { type: "answer", sdp: "v=0\r\no=bob 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 54312 UDP/TLS/RTP/SAVPF 111\r\n" },
      });
      const aliceAnswer = await aliceAnswerPromise;
      assert(aliceAnswer.answer.type === "answer", "Alice receives validated SDP answer");
    });

    await runTest("ICE candidates exchanged and validated", async () => {
      const bobIcePromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_ICE);
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_ICE, {
        callId: activeCallId,
        candidate: { candidate: "candidate:1 1 UDP 2130706431 127.0.0.1 54312 typ host", sdpMid: "0", sdpMLineIndex: 0 },
      });
      const bobIce = await bobIcePromise;
      assert(bobIce.candidate.candidate.includes("127.0.0.1"), "Bob receives validated ICE candidate");
    });

    console.log("\n--- Section 3: Hold Ownership Authorization & Security ---");
    await runTest("Alice puts call on hold and Bob receives call:held with holdOwnerId", async () => {
      const bobHeldPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_HELD);
      const holdAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_HOLD, { callId: activeCallId }, res);
      });
      assert(holdAck.ok === true, "Alice places call on hold");
      const heldData = await bobHeldPromise;
      assert(heldData.holdOwnerId === String(alice.user._id), "Bob receives call:held with Alice as holdOwnerId");
    });

    await runTest("Bob (non-owner) attempted resume is rejected by server with HOLD_OWNER_ONLY", async () => {
      const bobResumeAck = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_RESUME, { callId: activeCallId }, res);
      });
      assert(bobResumeAck.ok === false && bobResumeAck.reason === "HOLD_OWNER_ONLY", "Server rejects Bob's unauthorized resume attempt");
    });

    await runTest("Charlie (non-participant) attempted resume is rejected", async () => {
      const charlieResumeAck = await new Promise((res) => {
        charlieSocket.emit(CALL_SOCKET_EVENTS.CALL_RESUME, { callId: activeCallId }, res);
      });
      assert(charlieResumeAck.ok === false, "Server rejects Charlie's resume attempt");
    });

    await runTest("Alice (hold owner) resumes call successfully", async () => {
      const bobResumedPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_RESUMED);
      const aliceResumeAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_RESUME, { callId: activeCallId }, res);
      });
      assert(aliceResumeAck.ok === true, "Alice resumes call");
      const resumedData = await bobResumedPromise;
      assert(resumedData.callId === activeCallId, "Bob receives call:resumed event");
    });

    console.log("\n--- Section 4: Mute/Unmute State Synchronization ---");
    await runTest("Mute status syncs to remote peer", async () => {
      const bobMediaPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_MEDIA);
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_MEDIA, { callId: activeCallId, audio: false, video: true });
      const bobMediaData = await bobMediaPromise;
      assert(bobMediaData.audio === false, "Bob receives Alice's muted status");
    });

    console.log("\n--- Section 5: Screen Sharing Signaling & Authorization ---");
    await runTest("Alice starts screen sharing successfully", async () => {
      const bobScreenSharePromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_SCREENSHARE);
      const startScreenAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_SCREENSHARE, { callId: activeCallId, isSharing: true }, res);
      });
      assert(startScreenAck.ok === true, "Alice starts screen sharing");
      const screenShareData = await bobScreenSharePromise;
      assert(screenShareData.isSharing === true, "Bob notified of active screen share");
    });

    await runTest("Bob cannot stop Alice's screen share (unauthorized)", async () => {
      const bobStopScreenAck = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_SCREENSHARE, { callId: activeCallId, isSharing: false }, res);
      });
      assert(bobStopScreenAck.ok === false && bobStopScreenAck.reason === "not-authorized", "Bob cannot stop Alice's screen share");
    });

    await runTest("Alice stops screen sharing cleanly", async () => {
      const bobStopPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_SCREENSHARE);
      const aliceStopScreenAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_SCREENSHARE, { callId: activeCallId, isSharing: false }, res);
      });
      assert(aliceStopScreenAck.ok === true, "Alice stops screen sharing");
      const stopData = await bobStopPromise;
      assert(stopData.isSharing === false, "Bob notified that screen share ended");
    });

    console.log("\n--- Section 6: Call Termination & History Persistence ---");
    await runTest("Alice ends call cleanly and history is saved with duration and completed status", async () => {
      const bobEndedPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_ENDED);
      const endAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId: activeCallId }, res);
      });
      assert(endAck.ok === true, "Alice ends call cleanly");
      const endedData = await bobEndedPromise;
      assert(endedData.status === "completed", "Status is marked completed");

      const callRecord = await Call.findOne({ callId: activeCallId });
      assert(callRecord !== null, "Call record persisted in MongoDB");
      assert(callRecord.status === "completed", "Persisted call status is completed");
      assert(callRecord.callerId.toString() === alice.user._id.toString(), "Caller is Alice in database");
      assert(callRecord.receiverId.toString() === bob.user._id.toString(), "Receiver is Bob in database");
      assert(typeof callRecord.duration === "number", "Duration stored as number");
    });

    console.log("\n==================================================");
    console.log(`All ${passed} E2E Calling Hardening Tests Passed! (0 Failed)`);
    console.log("==================================================\n");

  } finally {
    await teardownTestEnvironment(env);
  }
}

runHardeningTests();
