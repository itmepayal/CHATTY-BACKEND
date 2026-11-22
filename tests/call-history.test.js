import {
  setupTestEnvironment,
  teardownTestEnvironment,
} from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import request from "supertest";
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

async function runCallHistoryTests() {
  console.log("\n==================================================");
  console.log("Starting Professional Call History Verification Suite");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie } = users;
  const aliceSocket = alice.socket;
  const bobSocket = bob.socket;

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
    console.log("--- Category 1: Single Call Record Deletion & Per-User Isolation ---");

    // Seed test calls between Alice and Bob
    const call1 = await Call.create({
      callId: "test-call-1",
      callerId: alice.user._id,
      receiverId: bob.user._id,
      type: "audio",
      status: "completed",
      duration: 120,
      startedAt: new Date(Date.now() - 3600000),
      endedAt: new Date(),
    });

    const call2 = await Call.create({
      callId: "test-call-2",
      callerId: bob.user._id,
      receiverId: alice.user._id,
      type: "audio",
      status: "completed",
      duration: 65,
      startedAt: new Date(Date.now() - 2400000),
      endedAt: new Date(),
    });

    const call3 = await Call.create({
      callId: "test-call-3",
      callerId: alice.user._id,
      receiverId: bob.user._id,
      type: "video",
      status: "completed",
      duration: 300,
      startedAt: new Date(Date.now() - 1200000),
      endedAt: new Date(),
    });

    const call4 = await Call.create({
      callId: "test-call-4",
      callerId: bob.user._id,
      receiverId: alice.user._id,
      type: "video",
      status: "missed",
      duration: 0,
      startedAt: new Date(Date.now() - 600000),
      endedAt: new Date(),
    });

    await testCase("[Fetch] Alice and Bob initially see all 4 calls in their history", async () => {
      const resAlice = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);
      assert(resAlice.body.data.length === 4, "Alice must see 4 calls");

      const resBob = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resBob.body.data.length === 4, "Bob must see 4 calls");
    });

    await testCase("[Delete Single] Alice deletes call1 (outgoing voice call); Bob still retains it", async () => {
      let aliceReceivedSocketEvent = false;
      let bobReceivedSocketEvent = false;

      const aliceHandler = (data) => {
        if (data.callId === call1.callId || data.callId === String(call1._id)) {
          aliceReceivedSocketEvent = true;
        }
      };
      const bobHandler = () => {
        bobReceivedSocketEvent = true;
      };

      aliceSocket.once("call:history:deleted", aliceHandler);
      bobSocket.once("call:history:deleted", bobHandler);

      const res = await request(app)
        .delete(`/api/calls/history/${call1.callId}`)
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);
      assert(res.body.success === true, "Deletion must report success");

      await delay(150);

      assert(aliceReceivedSocketEvent === true, "Alice must receive real-time call:history:deleted event");
      assert(bobReceivedSocketEvent === false, "Bob must NOT receive Alice's deletion socket event");

      // Verify Alice no longer sees call1
      const resAlice = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);
      assert(resAlice.body.data.length === 3, "Alice must now see only 3 calls");
      assert(!resAlice.body.data.some((c) => c.callId === call1.callId), "Call 1 must not appear in Alice's history");

      // Verify Bob STILL sees call1
      const resBob = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resBob.body.data.length === 4, "Bob's call history must remain completely intact (4 calls)");
      assert(resBob.body.data.some((c) => c.callId === call1.callId), "Bob must still see Call 1");
    });

    await testCase("[Delete Single] Alice deletes call4 (incoming missed call); Bob still retains it", async () => {
      await request(app)
        .delete(`/api/calls/history/${call4._id}`)
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);

      const resAlice = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);
      assert(resAlice.body.data.length === 2, "Alice must now see only 2 calls");
      assert(!resAlice.body.data.some((c) => c.callId === call4.callId), "Call 4 must not appear in Alice's history");

      const resBob = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resBob.body.data.length === 4, "Bob must still see all 4 calls");
    });

    console.log("\n--- Category 2: Security & Authorization ---");

    await testCase("[Security] Non-participant Charlie cannot delete a call between Alice and Bob", async () => {
      await request(app)
        .delete(`/api/calls/history/${call2.callId}`)
        .set("Authorization", `Bearer ${charlie.accessToken}`)
        .expect(404);

      // Verify call2 is untouched for both Alice and Bob
      const resAlice = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);
      assert(resAlice.body.data.some((c) => c.callId === call2.callId), "Alice must still have Call 2");

      const resBob = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resBob.body.data.some((c) => c.callId === call2.callId), "Bob must still have Call 2");
    });

    await testCase("[Security] Invalid call ID parameter is rejected with 400 Bad Request", async () => {
      await request(app)
        .delete("/api/calls/history/$$invalid-id$$!")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(400);
    });

    console.log("\n--- Category 3: Bulk Selection & Bulk Deletion ---");

    // Seed 4 additional calls for Alice and Bob
    const call5 = await Call.create({
      callId: "test-call-5",
      callerId: alice.user._id,
      receiverId: bob.user._id,
      type: "audio",
      status: "completed",
      duration: 40,
      startedAt: new Date(),
    });
    const call6 = await Call.create({
      callId: "test-call-6",
      callerId: bob.user._id,
      receiverId: alice.user._id,
      type: "video",
      status: "completed",
      duration: 150,
      startedAt: new Date(),
    });

    await testCase("[Bulk Delete] Alice bulk-deletes call2 and call5 with POST /api/calls/history/bulk-delete", async () => {
      let aliceBulkSocketFired = false;
      let bobBulkSocketFired = false;

      aliceSocket.once("call:history:bulk-deleted", (data) => {
        if (data.callIds?.includes(call5.callId)) aliceBulkSocketFired = true;
      });
      bobSocket.once("call:history:bulk-deleted", () => {
        bobBulkSocketFired = true;
      });

      const res = await request(app)
        .post("/api/calls/history/bulk-delete")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .send({ callIds: [call2.callId, call5.callId] })
        .expect(200);

      assert(res.body.success === true, "Bulk delete must report success");
      assert(res.body.data.count >= 2, "Bulk delete must report modified count");

      await delay(150);

      assert(aliceBulkSocketFired === true, "Alice must receive real-time bulk-deleted event");
      assert(bobBulkSocketFired === false, "Bob must NOT receive Alice's bulk-deleted event");

      const resAlice = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);

      assert(!resAlice.body.data.some((c) => c.callId === call2.callId), "Call 2 must be deleted for Alice");
      assert(!resAlice.body.data.some((c) => c.callId === call5.callId), "Call 5 must be deleted for Alice");

      // Verify Bob still sees call2 and call5
      const resBob = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resBob.body.data.some((c) => c.callId === call2.callId), "Bob must still see Call 2");
      assert(resBob.body.data.some((c) => c.callId === call5.callId), "Bob must still see Call 5");
    });

    await testCase("[Bulk Delete Validation] Empty array or non-array is rejected with 400 Bad Request", async () => {
      await request(app)
        .post("/api/calls/history/bulk-delete")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .send({ callIds: [] })
        .expect(400);

      await request(app)
        .post("/api/calls/history/bulk-delete")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .send({ callIds: "not-an-array" })
        .expect(400);
    });

    console.log("\n--- Category 4: Clear All Call History ---");

    await testCase("[Clear All] Alice clears all call history; Bob's history is unaffected", async () => {
      let aliceClearSocketFired = false;
      let bobClearSocketFired = false;

      aliceSocket.once("call:history:cleared", () => {
        aliceClearSocketFired = true;
      });
      bobSocket.once("call:history:cleared", () => {
        bobClearSocketFired = true;
      });

      const res = await request(app)
        .delete("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);

      assert(res.body.success === true, "Clear all must return success");

      await delay(150);

      assert(aliceClearSocketFired === true, "Alice must receive real-time call:history:cleared event");
      assert(bobClearSocketFired === false, "Bob must NOT receive clear-all event");

      // Alice's history must now be empty
      const resAlice = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);
      assert(resAlice.body.data.length === 0, "Alice's call history must be completely empty");

      // Bob's history must STILL have all his calls
      const resBob = await request(app)
        .get("/api/calls/history")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resBob.body.data.length >= 4, "Bob's call history must remain completely intact");
    });

    console.log("\n--- Category 5: Filters & Active Call Immunity ---");

    // Seed diverse calls for Bob: voice incoming, video incoming, voice outgoing, video outgoing, missed
    await Call.create([
      {
        callId: "filter-call-missed",
        callerId: alice.user._id,
        receiverId: bob.user._id,
        type: "audio",
        status: "missed",
        duration: 0,
        startedAt: new Date(),
      },
      {
        callId: "filter-call-video",
        callerId: alice.user._id,
        receiverId: bob.user._id,
        type: "video",
        status: "completed",
        duration: 180,
        startedAt: new Date(),
      },
    ]);

    await testCase("[Filters] Bob filters call history by missed, incoming, and type=video", async () => {
      const resMissed = await request(app)
        .get("/api/calls/history?status=missed")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resMissed.body.data.every((c) => c.status === "missed"), "All returned calls must have status=missed");

      const resVideo = await request(app)
        .get("/api/calls/history?type=video")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resVideo.body.data.every((c) => c.type === "video"), "All returned calls must have type=video");

      const resIncoming = await request(app)
        .get("/api/calls/history?direction=incoming")
        .set("Authorization", `Bearer ${bob.accessToken}`)
        .expect(200);
      assert(resIncoming.body.data.every((c) => c.direction === "incoming"), "All returned calls must be incoming");
    });

    await testCase("[Active Call Safety] Deleting historical call records does not terminate an active call", async () => {
      // Simulate a call between Alice and Bob
      const activeCall = await Call.create({
        callId: "active-call-session",
        callerId: alice.user._id,
        receiverId: bob.user._id,
        type: "video",
        status: "completed",
        startedAt: new Date(),
      });

      // Alice clears her history
      await request(app)
        .delete("/api/calls/history")
        .set("Authorization", `Bearer ${alice.accessToken}`)
        .expect(200);

      // Verify call document is not globally deleted from DB
      const freshActiveCall = await Call.findOne({ callId: "active-call-session" });
      assert(freshActiveCall !== null, "Call document must not be deleted from DB");
      assert(freshActiveCall.status === "completed", "Call status must remain intact");
    });

    console.log("\n==================================================");
    console.log(`All ${passedTests}/${totalTests} Call History Tests Passed!`);
    console.log("==================================================\n");
  } finally {
    await teardownTestEnvironment(env);
  }
}

runCallHistoryTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
