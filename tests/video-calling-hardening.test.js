import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import Call from "../src/modules/calling/models/call.model.js";
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

async function runVideoCallingHardeningTests() {
  console.log("\n========================================================");
  console.log("Starting Video Calling Production Hardening Test Suite");
  console.log("========================================================\n");

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
    console.log("--- 1. Validation & Unauthorized Signaling Guards ---");

    await testCase("1.1 Self-call is rejected gracefully", async () => {
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(alice.user._id),
        type: "video",
      });
      assert(res.ok === false, "Self call should fail");
      assert(res.reason === "invalid", "Reason should be invalid");
    });

    await testCase("1.2 Missing target user is rejected gracefully", async () => {
      const res = await emitWithAck(alice.socket, "call:invite", {
        to: "000000000000000000000000",
        type: "video",
      });
      assert(res.ok === false, "Call to non-existent user should fail");
      assert(res.reason === "not-allowed" || res.reason === "offline", "Reason present");
    });

    console.log("\n--- 2. Call Lifecycle: Complete Video Call Flow ---");

    let activeCallId = null;

    await testCase("2.1 Alice invites Bob to a video call", async () => {
      const incomingPromise = waitForEvent(bob.socket, "call:incoming");

      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "video",
      });

      assert(res.ok === true, "Invite must succeed");
      assert(res.callId, "callId must be present");
      activeCallId = res.callId;

      const incoming = await incomingPromise;
      assert(incoming.callId === activeCallId, "Incoming callId matches");
      assert(incoming.type === "video", "Type is video");
      assert(String(incoming.from) === String(alice.user._id), "Caller is Alice");
    });

    await testCase("2.2 Bob accepts video call", async () => {
      const acceptedPromise = waitForEvent(alice.socket, "call:accepted");

      const res = await emitWithAck(bob.socket, "call:accept", {
        callId: activeCallId,
      });

      assert(res.ok === true, "Accept should succeed");

      const accepted = await acceptedPromise;
      assert(accepted.callId === activeCallId, "Accepted event matches callId");
    });

    await testCase("2.3 Duplicate accept from Bob is idempotent / safely rejected", async () => {
      const res = await emitWithAck(bob.socket, "call:accept", {
        callId: activeCallId,
      });
      assert(res.ok === false, "Duplicate accept should be safely rejected");
      assert(
        res.reason === "already-accepted" || res.reason === "already-ended",
        "Reason is already-accepted",
      );
    });

    await testCase("2.4 Charlie calling Bob receives call:waiting while Bob is busy", async () => {
      const waitingPromise = waitForEvent(bob.socket, "call:waiting");

      const res = await emitWithAck(charlie.socket, "call:invite", {
        to: String(bob.user._id),
        type: "video",
      });

      assert(res.ok === true, "Call invite generates call waiting");
      const waiting = await waitingPromise;
      assert(String(waiting.from) === String(charlie.user._id), "Waiting call is from Charlie");

      // Clean up Charlie's waiting call
      if (res.callId) {
        await emitWithAck(charlie.socket, "call:cancel", { callId: res.callId });
      }
    });

    console.log("\n--- 3. WebRTC Signaling: SDP, ICE & Security ---");

    await testCase("3.1 Valid SDP offer relayed from Alice to Bob", async () => {
      const offerPromise = waitForEvent(bob.socket, "call:offer");
      const validOffer = {
        type: "offer",
        sdp: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
      };

      alice.socket.emit("call:offer", {
        callId: activeCallId,
        offer: validOffer,
      });

      const relayed = await offerPromise;
      assert(relayed.callId === activeCallId, "CallId matches");
      assert(relayed.offer.type === "offer", "SDP offer relayed");
    });

    await testCase("3.2 Valid SDP answer relayed from Bob to Alice", async () => {
      const answerPromise = waitForEvent(alice.socket, "call:answer");
      const validAnswer = {
        type: "answer",
        sdp: "v=0\r\no=- 67890 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
      };

      bob.socket.emit("call:answer", {
        callId: activeCallId,
        answer: validAnswer,
      });

      const relayed = await answerPromise;
      assert(relayed.callId === activeCallId, "CallId matches");
      assert(relayed.answer.type === "answer", "SDP answer relayed");
    });

    await testCase("3.3 Valid ICE candidate relayed from Alice to Bob", async () => {
      const icePromise = waitForEvent(bob.socket, "call:ice");
      const candidate = {
        candidate: "candidate:1 1 UDP 2130706431 192.168.1.50 50000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };

      alice.socket.emit("call:ice", {
        callId: activeCallId,
        candidate,
      });

      const relayed = await icePromise;
      assert(relayed.callId === activeCallId);
      assert(relayed.candidate.candidate.includes("192.168.1.50"));
    });

    await testCase("3.4 Unauthorized peer Charlie cannot inject ICE candidate", async () => {
      let relayedToBob = false;
      const listener = () => { relayedToBob = true; };
      bob.socket.once("call:ice", listener);

      charlie.socket.emit("call:ice", {
        callId: activeCallId,
        candidate: {
          candidate: "candidate:99 1 UDP 2130706431 10.0.0.99 50000 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });

      await delay(200);
      bob.socket.off("call:ice", listener);
      assert(relayedToBob === false, "Unauthorized candidate must be blocked");
    });

    console.log("\n--- 4. Media State & Screen Sharing Synchronization ---");

    await testCase("4.1 Video media mute/unmute state relayed", async () => {
      const mediaPromise = waitForEvent(bob.socket, "call:media");

      alice.socket.emit("call:media", {
        callId: activeCallId,
        audio: true,
        video: false, // Alice turned off camera
      });

      const media = await mediaPromise;
      assert(media.callId === activeCallId);
      assert(media.video === false, "video disabled reflected to peer");
      assert(media.audio === true, "audio enabled reflected to peer");
    });

    await testCase("4.2 Screen share activation and deactivation relayed", async () => {
      const screenStartPromise = waitForEvent(bob.socket, "call:screenshare");

      alice.socket.emit("call:screenshare", {
        callId: activeCallId,
        isSharing: true,
      });

      const startEvent = await screenStartPromise;
      assert(startEvent.isSharing === true);
      assert(String(startEvent.userId) === String(alice.user._id));

      const screenStopPromise = waitForEvent(bob.socket, "call:screenshare");

      alice.socket.emit("call:screenshare", {
        callId: activeCallId,
        isSharing: false,
      });

      const stopEvent = await screenStopPromise;
      assert(stopEvent.isSharing === false);
    });

    console.log("\n--- 5. Call Termination & History Persistence ---");

    await testCase("5.1 Alice terminates call -> both receive call:ended with computed duration", async () => {
      const bobEndedPromise = waitForEvent(bob.socket, "call:ended");
      const aliceEndedPromise = waitForEvent(alice.socket, "call:ended");

      const res = await emitWithAck(alice.socket, "call:end", {
        callId: activeCallId,
      });

      assert(res.ok === true, "Call end must succeed");

      const [bobEnded, aliceEnded] = await Promise.all([
        bobEndedPromise,
        aliceEndedPromise,
      ]);

      assert(bobEnded.callId === activeCallId);
      assert(aliceEnded.callId === activeCallId);

      // Verify database record
      await delay(200);
      const callDoc = await Call.findOne({ callId: activeCallId });
      assert(callDoc !== null, "Call record must exist in DB");
      assert(callDoc.status === "completed", "Call status must be completed");
      assert(typeof callDoc.duration === "number", "Duration must be calculated");
    });

    console.log("\n--- 6. Cancellation & Rejection Terminal States ---");

    await testCase("6.1 Caller cancels outgoing call before callee answers", async () => {
      const incomingPromise = waitForEvent(bob.socket, "call:incoming");

      const inviteRes = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "video",
      });

      assert(inviteRes.ok === true);
      const tempCallId = inviteRes.callId;
      await incomingPromise;

      const bobEndedPromise = waitForEvent(bob.socket, "call:ended");
      const cancelRes = await emitWithAck(alice.socket, "call:cancel", {
        callId: tempCallId,
      });

      assert(cancelRes.ok === true, "Cancel must succeed");
      const bobEnded = await bobEndedPromise;
      assert(bobEnded.callId === tempCallId);
      assert(bobEnded.reason === "cancelled", "End reason must be cancelled");

      await delay(200);
      const doc = await Call.findOne({ callId: tempCallId });
      assert(doc && doc.status === "cancelled", "DB status must be cancelled");
    });

    await testCase("6.2 Callee rejects incoming video call", async () => {
      const incomingPromise = waitForEvent(bob.socket, "call:incoming");

      const inviteRes = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "video",
      });

      assert(inviteRes.ok === true);
      const tempCallId = inviteRes.callId;
      await incomingPromise;

      const aliceEndedPromise = waitForEvent(alice.socket, "call:ended");
      const rejectRes = await emitWithAck(bob.socket, "call:reject", {
        callId: tempCallId,
      });

      assert(rejectRes.ok === true, "Reject must succeed");
      const aliceEnded = await aliceEndedPromise;
      assert(aliceEnded.callId === tempCallId);
      assert(aliceEnded.reason === "rejected", "End reason must be rejected");

      await delay(200);
      const doc = await Call.findOne({ callId: tempCallId });
      assert(doc && doc.status === "rejected", "DB status must be rejected");
    });

    console.log("\n========================================================");
    console.log(`Video Calling Hardening: ${passedTests}/${totalTests} tests passed.`);
    console.log("========================================================\n");
  } finally {
    await teardownTestEnvironment(env);
  }
}

runVideoCallingHardeningTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Fatal error running hardening tests:", err);
    process.exit(1);
  });
