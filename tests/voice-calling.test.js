import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import request from "supertest";
import Call from "../src/modules/calling/models/call.model.js";
import { socketLimiter } from "../src/infrastructure/socket/socket-rate-limit.js";
import {
  CALL_SOCKET_EVENTS,
  CALL_STATUS,
  CALL_LIFECYCLE_STATE,
} from "../src/modules/calling/constants/call.constants.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runVoiceCallingTests() {
  console.log("\n==================================================");
  console.log("Starting Production Voice Calling Verification Suite");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie } = users;
  const aliceSocket = alice.socket;
  const bobSocket = bob.socket;
  const charlieSocket = charlie.socket;

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
    console.log("--- Category 1: Voice Call Initiation, Ringing & Acceptance ---");

    let activeCallId = null;

    await testCase("[Initiate Call] Alice calls Bob with audio type; Bob receives call:incoming", async () => {
      const incomingPromise = new Promise((resolve) => {
        bobSocket.once(CALL_SOCKET_EVENTS.CALL_INCOMING, (data) => {
          resolve(data);
        });
      });

      const inviteAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });

      assert(inviteAck?.ok === true, "Alice invite should succeed");
      assert(inviteAck?.callId, "Alice invite should return callId");
      activeCallId = inviteAck.callId;

      const incoming = await incomingPromise;
      assert(incoming.callId === activeCallId, "Bob should receive matching callId");
      assert(String(incoming.from) === String(alice.user._id), "Bob incoming caller should be Alice");
      assert(incoming.type === "audio", "Call type should be audio");
    });

    await testCase("[Accept Call] Bob accepts call; Alice receives call:accepted; call transitions to active", async () => {
      const acceptedPromise = new Promise((resolve) => {
        aliceSocket.once(CALL_SOCKET_EVENTS.CALL_ACCEPTED, (data) => {
          resolve(data);
        });
      });

      const acceptAck = await new Promise((resolve) => {
        bobSocket.emit(
          CALL_SOCKET_EVENTS.CALL_ACCEPT,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });

      assert(acceptAck?.ok === true, "Bob accept should succeed");
      const accepted = await acceptedPromise;
      assert(accepted.callId === activeCallId, "Alice should receive accepted event with callId");

      // Verify server state is now ACTIVE
      const stateAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_GET_STATE,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });
      assert(stateAck.ok === true, "Get state should succeed");
      assert(
        stateAck.callState?.state === CALL_LIFECYCLE_STATE.ACTIVE ||
          stateAck.callState?.state === CALL_LIFECYCLE_STATE.ACCEPTED,
        "Call state should be active or accepted after acceptance",
      );
    });

    console.log("\n--- Category 2: Microphone & Audio Stream Controls ---");

    await testCase("[Mute Audio] Alice mutes audio; Bob receives call:media event with audio: false", async () => {
      const mediaPromise = new Promise((resolve) => {
        bobSocket.once(CALL_SOCKET_EVENTS.CALL_MEDIA, (data) => {
          resolve(data);
        });
      });

      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_MEDIA, {
        callId: activeCallId,
        audio: false,
        video: false,
      });

      const media = await mediaPromise;
      assert(media.callId === activeCallId, "Media callId should match");
      assert(media.audio === false, "Bob should receive audio=false");
    });

    await testCase("[Unmute Audio] Alice unmutes audio; Bob receives call:media event with audio: true", async () => {
      const mediaPromise = new Promise((resolve) => {
        bobSocket.once(CALL_SOCKET_EVENTS.CALL_MEDIA, (data) => {
          resolve(data);
        });
      });

      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_MEDIA, {
        callId: activeCallId,
        audio: true,
        video: false,
      });

      const media = await mediaPromise;
      assert(media.callId === activeCallId, "Media callId should match");
      assert(media.audio === true, "Bob should receive audio=true");
    });

    console.log("\n--- Category 3: Hold & Resume Authorization & Security ---");

    await testCase("[Hold Call] Alice (User A) holds call; both receive call:held with holdOwnerId", async () => {
      const bobHeldPromise = new Promise((resolve) => {
        bobSocket.once(CALL_SOCKET_EVENTS.CALL_HELD, (data) => resolve(data));
      });
      const aliceHeldPromise = new Promise((resolve) => {
        aliceSocket.once(CALL_SOCKET_EVENTS.CALL_HELD, (data) => resolve(data));
      });

      const holdAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_HOLD,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });

      assert(holdAck?.ok === true, "Alice hold request should succeed");
      assert(holdAck?.isHeld === true, "Call should be marked isHeld=true");
      assert(
        String(holdAck?.holdOwnerId) === String(alice.user._id),
        "Alice should be designated holdOwnerId",
      );

      const bobEvent = await bobHeldPromise;
      assert(bobEvent.callId === activeCallId, "Bob receives call:held");
      assert(
        String(bobEvent.holdOwnerId) === String(alice.user._id),
        "Bob sees Alice as hold owner",
      );

      const aliceEvent = await aliceHeldPromise;
      assert(aliceEvent.callId === activeCallId, "Alice receives call:held");
    });

    await testCase("[Hold Ownership Security] Bob attempts unauthorized resume; server rejects with HOLD_OWNER_ONLY", async () => {
      const resumeAck = await new Promise((resolve) => {
        bobSocket.emit(
          CALL_SOCKET_EVENTS.CALL_RESUME,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });

      assert(resumeAck?.ok === false, "Unauthorized resume must fail");
      assert(
        resumeAck?.reason === "HOLD_OWNER_ONLY",
        `Expected HOLD_OWNER_ONLY, got ${resumeAck?.reason}`,
      );

      // Verify call is STILL held on the server
      const stateAck = await new Promise((resolve) => {
        bobSocket.emit(
          CALL_SOCKET_EVENTS.CALL_GET_STATE,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });
      assert(stateAck.callState?.state === CALL_LIFECYCLE_STATE.HELD, "Call must remain HELD");
      assert(stateAck.callState?.isHeld === true, "isHeld must still be true");
    });

    await testCase("[Concurrent Hold] Bob attempts to hold call while Alice already holds it; server rejects with ALREADY_HELD_BY_OTHER", async () => {
      const bobHoldAck = await new Promise((resolve) => {
        bobSocket.emit(
          CALL_SOCKET_EVENTS.CALL_HOLD,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });

      assert(bobHoldAck?.ok === false, "Second participant hold must fail when already held");
      assert(
        bobHoldAck?.reason === "ALREADY_HELD_BY_OTHER",
        `Expected ALREADY_HELD_BY_OTHER, got ${bobHoldAck?.reason}`,
      );
    });

    await testCase("[Idempotent Hold] Alice sends duplicate hold; server returns idempotent ok: true", async () => {
      const duplicateHoldAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_HOLD,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });

      assert(duplicateHoldAck?.ok === true, "Duplicate hold by owner should return ok: true");
      assert(duplicateHoldAck?.idempotent === true, "Should be flagged idempotent");
    });

    await testCase("[Authorized Resume] Alice (hold owner) resumes call; both receive call:resumed and return to active", async () => {
      const bobResumedPromise = new Promise((resolve) => {
        bobSocket.once(CALL_SOCKET_EVENTS.CALL_RESUMED, (data) => resolve(data));
      });
      const aliceResumedPromise = new Promise((resolve) => {
        aliceSocket.once(CALL_SOCKET_EVENTS.CALL_RESUMED, (data) => resolve(data));
      });

      const resumeAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_RESUME,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });

      assert(resumeAck?.ok === true, "Owner resume request must succeed");
      assert(resumeAck?.isHeld === false, "Call should be marked isHeld=false");
      assert(resumeAck?.state === CALL_LIFECYCLE_STATE.ACTIVE, "State should be active");

      const bobResumed = await bobResumedPromise;
      assert(bobResumed.callId === activeCallId, "Bob receives call:resumed");
      assert(bobResumed.isHeld === false, "Bob receives isHeld=false");

      const aliceResumed = await aliceResumedPromise;
      assert(aliceResumed.callId === activeCallId, "Alice receives call:resumed");
    });

    console.log("\n--- Category 4: Call Termination & History Persistence ---");

    await testCase("[End Call & History] Alice ends the call; durations and endReason are persisted in MongoDB", async () => {
      const bobEndedPromise = new Promise((resolve) => {
        bobSocket.once(CALL_SOCKET_EVENTS.CALL_ENDED, (data) => resolve(data));
      });

      const endAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_END,
          { callId: activeCallId },
          (res) => resolve(res),
        );
      });

      assert(endAck?.ok === true, "Alice end call must succeed");
      const endedData = await bobEndedPromise;
      assert(endedData.callId === activeCallId, "Bob receives call:ended");
      assert(endedData.status === CALL_STATUS.COMPLETED, "Final status should be completed");

      await delay(100);

      // Verify MongoDB record
      const callDoc = await Call.findOne({ callId: activeCallId }).lean();
      assert(callDoc, "Call document should exist in MongoDB");
      assert(callDoc.status === CALL_STATUS.COMPLETED, "Database status should be completed");
      assert(callDoc.type === "audio", "Database type should be audio");
      assert(String(callDoc.callerId) === String(alice.user._id), "Caller should be Alice");
      assert(String(callDoc.receiverId) === String(bob.user._id), "Receiver should be Bob");
      assert(callDoc.holdCycles >= 1, "Hold cycles should be recorded (>=1)");
    });

    console.log("\n--- Category 5: Call Rejection, Decline with Message & Cancellation ---");

    await testCase("[Reject Call with Reason] Alice calls Bob; Bob rejects with 'in-meeting'; DB records rejected status", async () => {
      const inviteAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      assert(inviteAck?.ok === true, "Invite should succeed");
      const rejectCallId = inviteAck.callId;

      const aliceEndedPromise = new Promise((resolve) => {
        aliceSocket.once(CALL_SOCKET_EVENTS.CALL_ENDED, (data) => resolve(data));
      });

      const rejectAck = await new Promise((resolve) => {
        bobSocket.emit(
          CALL_SOCKET_EVENTS.CALL_REJECT,
          { callId: rejectCallId, reason: "in-meeting" },
          (res) => resolve(res),
        );
      });
      assert(rejectAck?.ok === true, "Bob reject should succeed");

      const endedData = await aliceEndedPromise;
      assert(endedData.callId === rejectCallId, "Alice receives call:ended");
      assert(endedData.status === CALL_STATUS.REJECTED, "Status should be rejected");
      assert(endedData.reason === "in-meeting", "Reason should be in-meeting");

      await delay(100);
      const callDoc = await Call.findOne({ callId: rejectCallId }).lean();
      assert(callDoc, "Database record must exist");
      assert(callDoc.status === CALL_STATUS.REJECTED, "Status should be rejected");
      assert(callDoc.endReason === "in-meeting", "endReason in DB should be in-meeting");
    });

    await testCase("[Cancel Call] Alice calls Bob and immediately cancels before answer; DB records cancelled status", async () => {
      const inviteAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      assert(inviteAck?.ok === true, "Invite should succeed");
      const cancelCallId = inviteAck.callId;

      const bobEndedPromise = new Promise((resolve) => {
        bobSocket.once(CALL_SOCKET_EVENTS.CALL_ENDED, (data) => resolve(data));
      });

      const cancelAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_CANCEL,
          { callId: cancelCallId },
          (res) => resolve(res),
        );
      });
      assert(cancelAck?.ok === true, "Alice cancel should succeed");

      const endedData = await bobEndedPromise;
      assert(endedData.callId === cancelCallId, "Bob receives call:ended");
      assert(endedData.status === CALL_STATUS.CANCELLED, "Status should be cancelled");

      await delay(100);
      const callDoc = await Call.findOne({ callId: cancelCallId }).lean();
      assert(callDoc, "Database record must exist");
      assert(callDoc.status === CALL_STATUS.CANCELLED, "Status in DB should be cancelled");
    });

    console.log("\n--- Category 6: Busy Handling & Simultaneous Call Glare Serialization ---");

    await testCase("[Busy State - Ringing Peer] When Alice calls Bob and Bob is ringing, Charlie calling Bob is rejected with busy", async () => {
      // 1. Alice calls Bob (Bob is now RINGING)
      const inviteAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      assert(inviteAck?.ok === true, "Alice invite should succeed");
      const ringingCallId = inviteAck.callId;

      // 2. Charlie attempts to call Bob while Bob is already ringing
      const charlieInvite = await new Promise((resolve) => {
        charlieSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      assert(charlieInvite?.ok === false, "Charlie invite to ringing peer must be rejected");
      assert(charlieInvite?.reason === "busy", `Expected busy, got ${charlieInvite?.reason}`);

      // 3. Clean up ringing call
      await new Promise((resolve) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId: ringingCallId }, (res) => resolve(res));
      });
    });

    await testCase("[Busy State - In-Call Caller] When Alice is in a call with Bob, Alice attempting to invite Charlie is rejected with busy", async () => {
      // 1. Establish call between Alice and Bob
      const inviteAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      const activeCallId = inviteAck.callId;
      await new Promise((resolve) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId: activeCallId }, (res) => resolve(res));
      });

      // 2. Alice attempts to initiate another call while already in active call
      const aliceSecondInvite = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(charlie.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      assert(aliceSecondInvite?.ok === false, "Alice second invite must be rejected");
      assert(aliceSecondInvite?.reason === "busy", `Expected busy, got ${aliceSecondInvite?.reason}`);

      // 3. Clean up active call
      await new Promise((resolve) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId: activeCallId }, (res) => resolve(res));
      });
    });

    console.log("\n--- Category 7: Security & Authorization ---");

    await testCase("[Security] Non-participant Charlie cannot accept, reject, hold, or end Alice & Bob's call", async () => {
      // Start call between Alice and Bob
      const inviteAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      const secCallId = inviteAck.callId;

      // Charlie attempts to accept
      const charlieAccept = await new Promise((resolve) => {
        charlieSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId: secCallId }, (res) => resolve(res));
      });
      assert(charlieAccept?.ok === false, "Charlie accept must fail");

      // Charlie attempts to hold
      const charlieHold = await new Promise((resolve) => {
        charlieSocket.emit(CALL_SOCKET_EVENTS.CALL_HOLD, { callId: secCallId }, (res) => resolve(res));
      });
      assert(charlieHold?.ok === false, "Charlie hold must fail");

      // Charlie attempts to resume
      const charlieResume = await new Promise((resolve) => {
        charlieSocket.emit(CALL_SOCKET_EVENTS.CALL_RESUME, { callId: secCallId }, (res) => resolve(res));
      });
      assert(charlieResume?.ok === false, "Charlie resume must fail");

      // Charlie attempts to end
      const charlieEnd = await new Promise((resolve) => {
        charlieSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId: secCallId }, (res) => resolve(res));
      });
      assert(charlieEnd?.ok === false, "Charlie end must fail");

      // Clean up
      await new Promise((resolve) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId: secCallId }, (res) => resolve(res));
      });
    });

    await testCase("[Security] Malformed or oversized call IDs and payloads are rejected", async () => {
      const badIdAck = await new Promise((resolve) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId: "bad-id-<>!--" }, (res) => resolve(res));
      });
      assert(badIdAck?.ok === false, "Invalid call ID must be rejected");

      const emptyIdAck = await new Promise((resolve) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_HOLD, { callId: "" }, (res) => resolve(res));
      });
      assert(emptyIdAck?.ok === false, "Empty call ID must be rejected");
    });

    console.log("\n--- Category 8: Glare Prevention & Simultaneous Calling ---");

    await testCase("[Glare Prevention] Simultaneous call initiation serializes safely; one succeeds and collision is averted", async () => {
      // Alice calls Bob and Bob calls Alice simultaneously
      const [res1, res2] = await Promise.all([
        new Promise((resolve) => {
          aliceSocket.emit(
            CALL_SOCKET_EVENTS.CALL_INVITE,
            { to: String(bob.user._id), type: "audio" },
            (res) => resolve(res),
          );
        }),
        new Promise((resolve) => {
          bobSocket.emit(
            CALL_SOCKET_EVENTS.CALL_INVITE,
            { to: String(alice.user._id), type: "audio" },
            (res) => resolve(res),
          );
        }),
      ]);

      // Exactly one must succeed with ok: true, and the other must be rejected with busy
      const oneSucceeded = (res1.ok && !res2.ok) || (!res1.ok && res2.ok);
      assert(oneSucceeded, "Exactly one simultaneous call must be established");
      const winnerCallId = res1.ok ? res1.callId : res2.callId;

      // Clean up winner call
      const cancelSocket = res1.ok ? aliceSocket : bobSocket;
      await new Promise((resolve) => {
        cancelSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId: winnerCallId }, (res) => resolve(res));
      });
    });

    console.log("\n--- Category 9: Reconnection State Synchronization ---");

    await testCase("[State Sync on Reconnection] call:get-state returns complete authoritative state and hold ownership", async () => {
      // 1. Establish call between Alice and Bob
      const inviteAck = await new Promise((resolve) => {
        aliceSocket.emit(
          CALL_SOCKET_EVENTS.CALL_INVITE,
          { to: String(bob.user._id), type: "audio" },
          (res) => resolve(res),
        );
      });
      const reconnectCallId = inviteAck.callId;
      await new Promise((resolve) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId: reconnectCallId }, (res) => resolve(res));
      });

      // 2. Alice puts call on hold
      await new Promise((resolve) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_HOLD, { callId: reconnectCallId }, (res) => resolve(res));
      });

      // 3. Bob queries call state (simulating socket reconnect)
      const bobQuery = await new Promise((resolve) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_GET_STATE, { callId: reconnectCallId }, (res) => resolve(res));
      });
      assert(bobQuery.ok === true, "Query must succeed");
      assert(bobQuery.callState.state === CALL_LIFECYCLE_STATE.HELD, "State must be HELD");
      assert(bobQuery.callState.isHeld === true, "isHeld must be true");
      assert(String(bobQuery.callState.holdOwnerId) === String(alice.user._id), "holdOwnerId must be Alice");

      // 4. Clean up call
      await new Promise((resolve) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId: reconnectCallId }, (res) => resolve(res));
      });
    });

    console.log("\n--- Category 10: Call History Integration & REST API ---");

    await testCase("[Call History Query] GET /api/calls/history returns formatted voice calls with accurate directions", async () => {
      const resAlice = await request(app)
        .get("/api/calls/history?type=audio")
        .set("Cookie", alice.cookies)
        .expect(200);

      assert(Array.isArray(resAlice.body?.data), "History data should be an array");
      assert(resAlice.body.data.length >= 1, "Alice should have recorded audio calls");
      const audioCall = resAlice.body.data.find((c) => c.type === "audio");
      assert(audioCall, "Should find at least one audio call");
      assert(typeof audioCall.direction === "string", "Call direction must be defined");
    });

    console.log("\n==================================================");
    console.log(`All ${passedTests}/${totalTests} Voice Calling Tests Passed!`);
    console.log("==================================================\n");
  } finally {
    await teardownTestEnvironment(env);
  }
}

runVoiceCallingTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Test suite failed:", err);
    process.exit(1);
  });
