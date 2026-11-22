import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
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

async function runScreenSharingTests() {
  console.log("\n==================================================");
  console.log("Starting Production Screen Sharing Verification Suite");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie, dave } = users;

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
    console.log("--- Category 1: 1:1 Screen Sharing & Authorization ---");

    let activeCallId = null;

    await testCase("[1:1 Call] Alice establishes video call with Bob", async () => {
      const incomingPromise = waitForEvent(bob.socket, "call:incoming");

      const res = await emitWithAck(alice.socket, "call:invite", {
        to: String(bob.user._id),
        type: "video",
      });

      assert(res.ok === true, "Call invite should succeed");
      activeCallId = res.callId;

      const incoming = await incomingPromise;
      assert(incoming.callId === activeCallId, "Incoming callId matches");

      const acceptedPromise = waitForEvent(alice.socket, "call:accepted");
      const acceptRes = await emitWithAck(bob.socket, "call:accept", {
        callId: activeCallId,
      });
      assert(acceptRes.ok === true, "Call accept succeeds");
      await acceptedPromise;
    });

    await testCase("[1:1 Screen Share] Alice starts screen sharing, Bob notified", async () => {
      const screensharePromise = waitForEvent(bob.socket, "call:screenshare");

      const ack = await emitWithAck(alice.socket, "call:screenshare", {
        callId: activeCallId,
        isSharing: true,
      });

      assert(ack.ok === true, "Screenshare start ack ok");
      assert(ack.isSharing === true, "Ack indicates isSharing: true");
      assert(String(ack.screenSharingUserId) === String(alice.user._id), "Alice is sharer");

      const event = await screensharePromise;
      assert(event.callId === activeCallId, "Event matches callId");
      assert(event.isSharing === true, "Event isSharing is true");
      assert(String(event.userId) === String(alice.user._id), "User ID is Alice");
    });

    await testCase("[1:1 Screen Share] Call state reflects active screen sharing", async () => {
      const stateRes = await emitWithAck(bob.socket, "call:get-state", {
        callId: activeCallId,
      });

      assert(stateRes.ok === true, "Get state succeeds");
      assert(stateRes.isScreenSharing === true, "State reports isScreenSharing true");
      assert(String(stateRes.screenSharingUserId) === String(alice.user._id), "Sharer is Alice");
    });

    await testCase("[1:1 Security] Unauthorized peer (Bob) cannot stop Alice's screen share", async () => {
      const ack = await emitWithAck(bob.socket, "call:screenshare", {
        callId: activeCallId,
        isSharing: false,
      });

      assert(ack.ok === false, "Unauthorized stop must be rejected");
      assert(ack.reason === "not-authorized", "Reason is not-authorized");
    });

    await testCase("[1:1 Screen Share] Alice stops screen sharing successfully", async () => {
      const screensharePromise = waitForEvent(bob.socket, "call:screenshare");

      const ack = await emitWithAck(alice.socket, "call:screenshare", {
        callId: activeCallId,
        isSharing: false,
      });

      assert(ack.ok === true, "Alice can stop her own screen share");
      assert(ack.isSharing === false, "Ack isSharing is false");

      const event = await screensharePromise;
      assert(event.isSharing === false, "Bob receives stop notification");
    });

    await testCase("[1:1 End] Alice ends the 1:1 call", async () => {
      const endedPromise = waitForEvent(bob.socket, "call:ended");
      await emitWithAck(alice.socket, "call:end", { callId: activeCallId });
      await endedPromise;
    });

    console.log("\n--- Category 2: Group Call Screen Sharing & Synchronization ---");

    let testGroup = null;
    let groupCallId = null;

    await testCase("[Group Setup] Create group with Alice (Admin), Bob, and Charlie", async () => {
      testGroup = await Group.create({
        name: "Screen Sharing Verification Group",
        owner: alice.user._id,
        createdBy: alice.user._id,
        members: [
          { userId: alice.user._id, role: "admin", joinedAt: new Date() },
          { userId: bob.user._id, role: "member", joinedAt: new Date() },
          { userId: charlie.user._id, role: "member", joinedAt: new Date() },
        ],
      });
      assert(testGroup, "Group created successfully");
    });

    await testCase("[Group Video] Alice starts group video call", async () => {
      const res = await emitWithAck(alice.socket, "gcall:start", {
        groupId: String(testGroup._id),
        type: "video",
      });

      assert(res.ok === true, "Group call start should succeed");
      groupCallId = res.callId;
    });

    await testCase("[Group Video] Bob joins the call", async () => {
      const res = await emitWithAck(bob.socket, "gcall:join", {
        groupId: String(testGroup._id),
      });

      assert(res.ok === true, "Bob joins group call");
      assert(res.screenSharingUserId === null, "Initially no one is sharing screen");
    });

    await testCase("[Group Screen Share] Bob starts screen sharing, Alice notified", async () => {
      const screensharePromise = waitForEvent(alice.socket, "gcall:screenshare");

      const ack = await emitWithAck(bob.socket, "gcall:screenshare", {
        callId: groupCallId,
        isSharing: true,
      });

      assert(ack.ok === true, "Bob screen sharing starts");
      assert(ack.isSharing === true, "isSharing is true");
      assert(String(ack.screenSharingUserId) === String(bob.user._id), "Sharer is Bob");

      const event = await screensharePromise;
      assert(event.callId === groupCallId, "Event callId matches");
      assert(event.isSharing === true, "Event isSharing is true");
      assert(String(event.userId) === String(bob.user._id), "Event user is Bob");
    });

    await testCase("[Group Sync] Charlie joins during active screen share, receives sharer info", async () => {
      const res = await emitWithAck(charlie.socket, "gcall:join", {
        groupId: String(testGroup._id),
      });

      assert(res.ok === true, "Charlie joins group call");
      assert(String(res.screenSharingUserId) === String(bob.user._id), "Charlie receives active sharer (Bob)");
    });

    await testCase("[Group Security] Non-host peer (Charlie) cannot stop Bob's screen share", async () => {
      const ack = await emitWithAck(charlie.socket, "gcall:screenshare", {
        callId: groupCallId,
        isSharing: false,
      });

      assert(ack.ok === false, "Charlie cannot stop Bob's screen share");
      assert(ack.reason === "not-authorized", "Reason is not-authorized");
    });

    await testCase("[Group Lifecycle] Active sharer (Bob) leaves, screen share auto-cleared", async () => {
      const screenshareEndPromise = waitForEvent(alice.socket, "gcall:screenshare");

      bob.socket.emit("gcall:leave", { callId: groupCallId });

      const event = await screenshareEndPromise;
      assert(event.isSharing === false, "Screen sharing automatically terminated");
      assert(String(event.userId) === String(bob.user._id), "Ended sharer was Bob");
    });

    await testCase("[Group Host Control] Alice starts sharing, host leaves and ends call", async () => {
      const ack = await emitWithAck(alice.socket, "gcall:screenshare", {
        callId: groupCallId,
        isSharing: true,
      });
      assert(ack.ok === true, "Alice can share");

      const endedPromise = waitForEvent(charlie.socket, "gcall:ended");
      alice.socket.emit("gcall:leave", { callId: groupCallId });
      await endedPromise;
    });

    console.log("\n==================================================");
    console.log(`All ${passedTests}/${totalTests} Screen Sharing Tests Passed!`);
    console.log("==================================================\n");
  } catch (err) {
    console.error("Screen sharing test suite failed:", err);
    process.exit(1);
  } finally {
    await teardownTestEnvironment(env);
  }
}

runScreenSharingTests();
