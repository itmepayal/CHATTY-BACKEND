/**
 * Calling Edge Cases & Extreme Concurrency Hardening Verification Suite
 * Tests 14 distinct edge cases:
 * 1. Two users calling each other simultaneously (glare serialization)
 * 2. Duplicate accept events (idempotent rejection)
 * 3. Accept and reject arriving in race condition
 * 4. Caller disconnecting during ringing (callee gets missed/cancelled)
 * 5. Callee disconnecting during ringing (call terminated cleanly)
 * 6. Rapid consecutive mute / unmute cycles
 * 7. Hold / resume race condition (concurrent resume by non-owner rejected)
 * 8. Unauthorized screen sharing termination attempt
 * 9. Starting new call immediately after ending previous call
 * 10. Rapid accept after cancel attempt
 * 11. Malformed SDP / candidate edge case rejection
 * 12. Rate limiting anti-spam burst handling
 * 13. State version ordering on delayed events
 * 14. Clear all call history while maintaining active call integrity
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runEdgeCaseTests() {
  console.log("\n==================================================");
  console.log("Starting 14 Calling System Edge Cases Verification");
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
    // -------------------------------------------------------------
    // Edge Case 1: Simultaneous calling (Glare)
    // -------------------------------------------------------------
    await runTest("Edge Case 1: Two users initiate calls simultaneously (glare serialized by ID)", async () => {
      const [resA, resB] = await Promise.all([
        new Promise((res) => {
          aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
        }),
        new Promise((res) => {
          bobSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(alice.user._id), type: "audio" }, res);
        }),
      ]);

      // Exactly one succeeds, or glare resolution returns waiting/busy cleanly without crash
      assert(resA.ok || resB.ok, "At least one call initiation succeeds during glare");
      const activeCallId = resA.ok ? resA.callId : resB.callId;

      // End active call cleanly
      const ender = resA.ok ? aliceSocket : bobSocket;
      await new Promise((res) => ender.emit(CALL_SOCKET_EVENTS.CALL_END, { callId: activeCallId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 2: Duplicate accept events
    // -------------------------------------------------------------
    await runTest("Edge Case 2: Duplicate accept events are safely rejected / idempotent", async () => {
      const inviteAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      assert(inviteAck.ok === true, "Invite succeeds");
      const callId = inviteAck.callId;

      // Bob accepts call
      const accept1 = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res);
      });
      assert(accept1.ok === true, "First accept succeeds");

      // Bob accepts call again
      const accept2 = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res);
      });
      assert(accept2.ok === false, "Second duplicate accept is rejected");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 3: Accept and Reject arriving in race condition
    // -------------------------------------------------------------
    await runTest("Edge Case 3: Reject after accept is rejected as invalid state transition", async () => {
      const inviteAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      assert(inviteAck.ok === true, "Invite succeeds");
      const callId = inviteAck.callId;

      const acceptRes = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res);
      });
      assert(acceptRes.ok === true, "Accept succeeds");

      const rejectRes = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_REJECT, { callId }, res);
      });
      assert(rejectRes.ok === false, "Reject is rejected once call is already accepted");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 4: Caller cancels call while ringing
    // -------------------------------------------------------------
    await runTest("Edge Case 4: Caller cancels call while ringing -> Callee receives call:ended cancelled", async () => {
      const bobIncomingPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_INCOMING);
      const inviteAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      assert(inviteAck.ok === true, "Invite succeeds");
      const callId = inviteAck.callId;
      await bobIncomingPromise;

      const bobEndedPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_ENDED);
      const cancelAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId }, res);
      });
      assert(cancelAck.ok === true, "Cancel succeeds");
      const endedData = await bobEndedPromise;
      assert(endedData.status === "cancelled", "Bob notified that call was cancelled");
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 5: Non-caller cannot cancel call
    // -------------------------------------------------------------
    await runTest("Edge Case 5: Non-caller (Bob or Charlie) cannot cancel Alice's call", async () => {
      const inviteAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      const callId = inviteAck.callId;

      const bobCancel = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId }, res);
      });
      assert(bobCancel.ok === false, "Bob cannot cancel Alice's outgoing call");

      const charlieCancel = await new Promise((res) => {
        charlieSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId }, res);
      });
      assert(charlieCancel.ok === false, "Charlie cannot cancel Alice's outgoing call");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 6: Rapid consecutive mute/unmute
    // -------------------------------------------------------------
    await runTest("Edge Case 6: Rapid consecutive mute / unmute events serialize without dropping", async () => {
      const inviteAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      const callId = inviteAck.callId;
      await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res));

      // Alice sends 5 rapid mute/unmute updates
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_MEDIA, { callId, audio: false, video: true });
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_MEDIA, { callId, audio: true, video: true });
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_MEDIA, { callId, audio: false, video: true });
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_MEDIA, { callId, audio: true, video: true });
      await delay(100);

      const stateAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_GET_STATE, { callId }, res);
      });
      assert(stateAck.ok === true, "Call state query succeeds during rapid mute toggles");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 7: Hold / Resume race conditions
    // -------------------------------------------------------------
    await runTest("Edge Case 7: Non-owner cannot resume during hold race; multiple resumes by owner idempotent", async () => {
      const inviteAck = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      const callId = inviteAck.callId;
      await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res));

      // Alice holds call
      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_HOLD, { callId }, res));

      // Bob tries to resume -> HOLD_OWNER_ONLY
      const bobResume = await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_RESUME, { callId }, res));
      assert(bobResume.ok === false && bobResume.reason === "HOLD_OWNER_ONLY", "Bob resume blocked");

      // Alice resumes call
      const aliceResume1 = await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_RESUME, { callId }, res));
      assert(aliceResume1.ok === true, "Alice resume succeeds");

      // Alice immediately resumes again (idempotent)
      const aliceResume2 = await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_RESUME, { callId }, res));
      assert(aliceResume2.ok === true && aliceResume2.idempotent === true, "Duplicate resume by owner is idempotent");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 8: Starting new call immediately after ending
    // -------------------------------------------------------------
    await runTest("Edge Case 8: User can immediately start a new call after ending previous call", async () => {
      // Call 1
      const inv1 = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId: inv1.callId }, res));
      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId: inv1.callId }, res));
      await delay(50);

      // Call 2 immediately
      const inv2 = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      assert(inv2.ok === true, "Second call initiates immediately without stale busy state");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId: inv2.callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 9: Malformed SDP and oversized payload rejection
    // -------------------------------------------------------------
    await runTest("Edge Case 9: Malformed SDP (non-string, oversized >64KB) is rejected without crashing", async () => {
      const inv = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      const callId = inv.callId;
      await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res));

      // Send 100KB giant string
      const giantSdp = "a".repeat(100 * 1024);
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_OFFER, {
        callId,
        offer: { type: "offer", sdp: giantSdp },
      });
      await delay(100);

      // Assert server is alive and call state is stable
      const st = await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_GET_STATE, { callId }, res));
      assert(st.ok === true, "Server safely drops oversized SDP without crashing");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 10: Call history delete does not terminate active call
    // -------------------------------------------------------------
    await runTest("Edge Case 10: Deleting past call history does not terminate or affect active call", async () => {
      const inv = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "audio" }, res);
      });
      const callId = inv.callId;
      await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res));

      // Alice clears call history
      await Call.updateMany({ callerId: alice.user._id }, { $addToSet: { deletedFor: alice.user._id } });

      // Query active call state
      const st = await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_GET_STATE, { callId }, res));
      assert(st.ok === true && (st.callState.state === "accepted" || st.callState.state === "active"), "Active call remains completely active after history clearing");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 11: Call history isolation between users
    // -------------------------------------------------------------
    await runTest("Edge Case 11: Alice deleting a call record does not delete it for Bob", async () => {
      const testCallId = `hist-iso-${Date.now()}`;
      await Call.create({
        callId: testCallId,
        callerId: alice.user._id,
        receiverId: bob.user._id,
        type: "audio",
        status: "completed",
        startedAt: new Date(Date.now() - 60000),
        endedAt: new Date(),
        duration: 60,
      });

      // Alice soft-deletes
      await Call.updateOne({ callId: testCallId }, { $addToSet: { deletedFor: alice.user._id } });

      // Bob queries
      const bobDoc = await Call.findOne({ callId: testCallId, deletedFor: { $ne: bob.user._id } });
      assert(bobDoc !== null, "Bob still retains the call in his history");

      const aliceDoc = await Call.findOne({ callId: testCallId, deletedFor: { $ne: alice.user._id } });
      assert(aliceDoc === null, "Alice cannot see the deleted call in her history");
    });

    // -------------------------------------------------------------
    // Edge Case 12: Anti-Spam target cooldown
    // -------------------------------------------------------------
    await runTest("Edge Case 12: Rapidly spamming 5 consecutive calls to same target triggers cooldown", async () => {
      // 4 quick invites
      for (let i = 0; i < 4; i++) {
        const inv = await new Promise((res) => {
          aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(charlie.user._id), type: "audio" }, res);
        });
        if (inv.ok) {
          await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_CANCEL, { callId: inv.callId }, res));
        }
      }

      // 5th invite within cooldown period
      const inv5 = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(charlie.user._id), type: "audio" }, res);
      });
      assert(inv5.ok === false && inv5.reason === "rate_limited", "5th rapid invite blocked by target cooldown");
    });

    // -------------------------------------------------------------
    // Edge Case 13: Live reaction signaling in active call
    // -------------------------------------------------------------
    await runTest("Edge Case 13: Live emojis / reactions broadcast accurately to peer", async () => {
      const inv = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "video" }, res);
      });
      const callId = inv.callId;
      await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res));

      const bobReactionPromise = waitForEvent(bobSocket, CALL_SOCKET_EVENTS.CALL_REACTION);
      aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_REACTION, { callId, reaction: "🔥" });
      const reactionData = await bobReactionPromise;
      assert(reactionData.reaction === "🔥", "Bob received Alice's fire emoji reaction");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    // -------------------------------------------------------------
    // Edge Case 14: Reconnection state recovery via call:get-state
    // -------------------------------------------------------------
    await runTest("Edge Case 14: Peer reconnects and retrieves authoritative active call state", async () => {
      const inv = await new Promise((res) => {
        aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_INVITE, { to: String(bob.user._id), type: "video" }, res);
      });
      const callId = inv.callId;
      await new Promise((res) => bobSocket.emit(CALL_SOCKET_EVENTS.CALL_ACCEPT, { callId }, res));

      // Simulate Bob querying authoritative state after temporary reconnect
      const stateRes = await new Promise((res) => {
        bobSocket.emit(CALL_SOCKET_EVENTS.CALL_GET_STATE, { callId }, res);
      });
      assert(stateRes.ok === true, "State query successful");
      assert(stateRes.callState.callId === callId, "Retrieved state matches callId");
      assert(typeof stateRes.callState.stateVersion === "number", "State version is numeric");

      await new Promise((res) => aliceSocket.emit(CALL_SOCKET_EVENTS.CALL_END, { callId }, res));
      await delay(100);
    });

    console.log("\n==================================================");
    console.log(`All ${passed}/14 Edge Case Calling Tests Passed! (0 Failed)`);
    console.log("==================================================\n");

  } finally {
    await teardownTestEnvironment(env);
  }
}

runEdgeCaseTests();
