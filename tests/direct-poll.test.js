import request from "supertest";
import mongoose from "mongoose";
import assert from "node:assert";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import {
  sendMessageLimiter,
  settingsLimiter,
} from "../src/middlewares/rateLimit/index.js";

function waitForEvent(socket, eventName, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let timer = null;
    const handler = (data) => {
      if (timer) clearTimeout(timer);
      socket.off(eventName, handler);
      resolve({ received: true, data });
    };
    timer = setTimeout(() => {
      socket.off(eventName, handler);
      resolve({ received: false, data: null });
    }, timeoutMs);
    socket.once(eventName, handler);
  });
}

async function resetLimits(...userIds) {
  const keys = [...userIds, "127.0.0.1", "::ffff:127.0.0.1", "::1"].filter(Boolean);
  for (const k of keys) {
    try {
      await sendMessageLimiter.resetKey(k);
      await settingsLimiter.resetKey(k);
    } catch {}
  }
}

export const results = [];
function recordResult(category, testName, expected, actual, pass, evidence = "") {
  results.push({ category, testName, expected, actual, pass, evidence });
  const symbol = pass ? "✓ PASS" : "✗ FAIL";
  console.log(`[${symbol}] [${category}] ${testName}`);
  if (!pass) {
    console.error(`       Expected: ${expected}`);
    console.error(`       Actual:   ${actual}`);
    if (evidence) console.error(`       Evidence: ${JSON.stringify(evidence)}`);
  }
}

async function runDirectPollTests() {
  console.log("\n==================================================");
  console.log("STARTING DIRECT 1:1 CHAT POLL SYSTEM VERIFICATION SUITE");
  console.log("==================================================\n");

  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie, david } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);
  const davidId = String(david.user._id);

  const resetAll = async () => {
    await resetLimits(aliceId, bobId, charlieId, davidId);
  };

  try {
    await resetAll();

    // ----------------------------------------------------
    // TEST 1: 1:1 Poll Creation & Clean Identity Serialization
    // ----------------------------------------------------
    let pollMessageId;
    let optionYesId;
    let optionNoId;
    let optionMaybeId;

    const bobSocketPromise = waitForEvent(bob.socket, "newMessage");

    const createRes = await request(app)
      .post("/api/v1/messages/polls")
      .set("Cookie", alice.cookies)
      .send({
        receiverId: bobId,
        question: "Do You Like JavaScript?",
        options: ["Yes", "No", "Maybe"],
        allowMultipleAnswers: false,
        canChangeVote: true,
        isAnonymous: false,
      });

    const is201 = createRes.status === 201;
    const msgData = createRes.body?.data?.message;
    const pollData = createRes.body?.data?.poll;

    // Critical check: senderId & receiverId MUST NOT be "[object Object]"
    const validSenderStr = msgData?.senderId === aliceId;
    const validReceiverStr = msgData?.receiverId === bobId;
    const notObjectString =
      msgData?.senderId !== "[object Object]" &&
      msgData?.receiverId !== "[object Object]";

    recordResult(
      "1:1 Poll Creation",
      "Alice creates poll for Bob with clean string IDs",
      "201 status and sender/receiver IDs are exact ObjectIds, not [object Object]",
      `Status: ${createRes.status}, senderId: ${msgData?.senderId}, receiverId: ${msgData?.receiverId}`,
      is201 && validSenderStr && validReceiverStr && notObjectString,
    );

    pollMessageId = msgData?.id;
    optionYesId = pollData?.options?.[0]?._id;
    optionNoId = pollData?.options?.[1]?._id;
    optionMaybeId = pollData?.options?.[2]?._id;

    // Check Socket.IO newMessage delivery to Bob
    const bobSocketResult = await bobSocketPromise;
    const bobSocketPayload = bobSocketResult.data;
    const bobSocketCleanIds =
      bobSocketPayload?.senderId === aliceId &&
      bobSocketPayload?.receiverId === bobId &&
      bobSocketPayload?.senderId !== "[object Object]";

    recordResult(
      "Real-Time Delivery",
      "Bob receives newMessage socket event with valid participant IDs",
      "Socket event received with senderId=aliceId, receiverId=bobId",
      `Received: ${bobSocketResult.received}, senderId: ${bobSocketPayload?.senderId}`,
      bobSocketResult.received && bobSocketCleanIds,
    );

    // ----------------------------------------------------
    // TEST 2: Single-Choice Voting (Bob votes YES)
    // ----------------------------------------------------
    await resetAll();
    const aliceVotePromise = waitForEvent(alice.socket, "pollUpdated");

    const vote1Res = await request(app)
      .post(`/api/v1/messages/${pollMessageId}/poll/vote`)
      .set("Cookie", bob.cookies)
      .send({ optionIds: [optionYesId] });

    const vote1Poll = vote1Res.body?.data?.poll;
    const yesOption = vote1Poll?.options?.find((o) => o._id === optionYesId);
    const noOption = vote1Poll?.options?.find((o) => o._id === optionNoId);

    const vote1Passed =
      vote1Res.status === 200 &&
      yesOption?.voteCount === 1 &&
      yesOption?.percentage === 100 &&
      yesOption?.hasVoted === true &&
      noOption?.voteCount === 0 &&
      noOption?.percentage === 0;

    recordResult(
      "Single-Choice Vote",
      "Bob votes YES on single-choice poll",
      "200 OK, YES=1 vote (100%), NO=0 votes (0%)",
      `Status: ${vote1Res.status}, YES count: ${yesOption?.voteCount}, %: ${yesOption?.percentage}`,
      vote1Passed,
    );

    const aliceSocketVote = await aliceVotePromise;
    recordResult(
      "Socket Synchronization",
      "Alice receives real-time pollUpdated event on Bob's vote",
      "Event received with messageId and updated poll",
      `Received: ${aliceSocketVote.received}`,
      aliceSocketVote.received && aliceSocketVote.data?.messageId === pollMessageId,
    );

    // ----------------------------------------------------
    // TEST 3: Change Vote (Bob changes YES to NO)
    // ----------------------------------------------------
    await resetAll();
    const vote2Res = await request(app)
      .post(`/api/v1/messages/${pollMessageId}/poll/vote`)
      .set("Cookie", bob.cookies)
      .send({ optionIds: [optionNoId] });

    const vote2Poll = vote2Res.body?.data?.poll;
    const yesOpt2 = vote2Poll?.options?.find((o) => o._id === optionYesId);
    const noOpt2 = vote2Poll?.options?.find((o) => o._id === optionNoId);

    const vote2Passed =
      vote2Res.status === 200 &&
      yesOpt2?.voteCount === 0 &&
      yesOpt2?.percentage === 0 &&
      noOpt2?.voteCount === 1 &&
      noOpt2?.percentage === 100;

    recordResult(
      "Vote Change",
      "Bob changes vote from YES to NO",
      "YES previous vote removed (0%), NO vote added (100%)",
      `YES count: ${yesOpt2?.voteCount}, NO count: ${noOpt2?.voteCount}`,
      vote2Passed,
    );

    // ----------------------------------------------------
    // TEST 4: Accurate Percentages & Multiple Voters
    // ----------------------------------------------------
    await resetAll();
    // Alice votes for YES
    const vote3Res = await request(app)
      .post(`/api/v1/messages/${pollMessageId}/poll/vote`)
      .set("Cookie", alice.cookies)
      .send({ optionIds: [optionYesId] });

    const vote3Poll = vote3Res.body?.data?.poll;
    const yesOpt3 = vote3Poll?.options?.find((o) => o._id === optionYesId);
    const noOpt3 = vote3Poll?.options?.find((o) => o._id === optionNoId);

    const vote3Passed =
      vote3Res.status === 200 &&
      yesOpt3?.voteCount === 1 &&
      yesOpt3?.percentage === 50 &&
      noOpt3?.voteCount === 1 &&
      noOpt3?.percentage === 50 &&
      vote3Poll?.totalVotes === 2;

    recordResult(
      "Percentage Math",
      "Alice votes YES while Bob has NO: total 2 votes (50% / 50%)",
      "50% for YES, 50% for NO, totalVotes=2",
      `YES %: ${yesOpt3?.percentage}, NO %: ${noOpt3?.percentage}, total: ${vote3Poll?.totalVotes}`,
      vote3Passed,
    );

    // ----------------------------------------------------
    // TEST 5: Multiple-Choice Poll (Select and Toggle)
    // ----------------------------------------------------
    await resetAll();
    const mcCreateRes = await request(app)
      .post("/api/v1/messages/polls")
      .set("Cookie", alice.cookies)
      .send({
        receiverId: bobId,
        question: "Which stacks do you use?",
        options: ["React", "Vue", "Node.js"],
        allowMultipleAnswers: true,
        canChangeVote: true,
      });

    const mcMsgId = mcCreateRes.body?.data?.message?.id;
    const optReact = mcCreateRes.body?.data?.poll?.options?.[0]?._id;
    const optVue = mcCreateRes.body?.data?.poll?.options?.[1]?._id;
    const optNode = mcCreateRes.body?.data?.poll?.options?.[2]?._id;

    // Bob selects React AND Node.js
    const mcVote1Res = await request(app)
      .post(`/api/v1/messages/${mcMsgId}/poll/vote`)
      .set("Cookie", bob.cookies)
      .send({ optionIds: [optReact, optNode] });

    const mcPoll1 = mcVote1Res.body?.data?.poll;
    const rOpt = mcPoll1?.options?.find((o) => o._id === optReact);
    const vOpt = mcPoll1?.options?.find((o) => o._id === optVue);
    const nOpt = mcPoll1?.options?.find((o) => o._id === optNode);

    const mc1Passed =
      mcVote1Res.status === 200 &&
      rOpt?.voteCount === 1 &&
      vOpt?.voteCount === 0 &&
      nOpt?.voteCount === 1;

    recordResult(
      "Multiple-Choice Voting",
      "Bob casts multiple votes (React + Node.js)",
      "React=1, Vue=0, Node.js=1",
      `React: ${rOpt?.voteCount}, Vue: ${vOpt?.voteCount}, Node: ${nOpt?.voteCount}`,
      mc1Passed,
    );

    // Bob deselects React (retains Node.js)
    await resetAll();
    const mcVote2Res = await request(app)
      .post(`/api/v1/messages/${mcMsgId}/poll/vote`)
      .set("Cookie", bob.cookies)
      .send({ optionIds: [optNode] });

    const mcPoll2 = mcVote2Res.body?.data?.poll;
    const rOpt2 = mcPoll2?.options?.find((o) => o._id === optReact);
    const nOpt2 = mcPoll2?.options?.find((o) => o._id === optNode);

    const mc2Passed =
      mcVote2Res.status === 200 &&
      rOpt2?.voteCount === 0 &&
      nOpt2?.voteCount === 1;

    recordResult(
      "Multiple-Choice Deselection",
      "Bob deselects React, keeping Node.js active",
      "React=0, Node.js=1",
      `React: ${rOpt2?.voteCount}, Node: ${nOpt2?.voteCount}`,
      mc2Passed,
    );

    // ----------------------------------------------------
    // TEST 6: Atomic Concurrent Voting Safety
    // ----------------------------------------------------
    await resetAll();
    const concCreateRes = await request(app)
      .post("/api/v1/messages/polls")
      .set("Cookie", alice.cookies)
      .send({
        receiverId: bobId,
        question: "Testing Concurrency",
        options: ["Option Alpha", "Option Beta"],
        allowMultipleAnswers: false,
      });

    const concMsgId = concCreateRes.body?.data?.message?.id;
    const optAlpha = concCreateRes.body?.data?.poll?.options?.[0]?._id;
    const optBeta = concCreateRes.body?.data?.poll?.options?.[1]?._id;

    // Fire 2 concurrent vote requests simultaneously
    const [concResAlice, concResBob] = await Promise.all([
      request(app)
        .post(`/api/v1/messages/${concMsgId}/poll/vote`)
        .set("Cookie", alice.cookies)
        .send({ optionIds: [optAlpha] }),
      request(app)
        .post(`/api/v1/messages/${concMsgId}/poll/vote`)
        .set("Cookie", bob.cookies)
        .send({ optionIds: [optBeta] }),
    ]);

    const bothSucceeded =
      concResAlice.status === 200 && concResBob.status === 200;

    // Check persisted message in DB to verify neither vote was lost
    const persistedConcMsg = await mongoose.model("Message").findById(concMsgId).lean();
    const pAlpha = persistedConcMsg.poll.options.find((o) => String(o._id) === optAlpha);
    const pBeta = persistedConcMsg.poll.options.find((o) => String(o._id) === optBeta);
    const noLostUpdates =
      pAlpha?.votes?.length === 1 && pBeta?.votes?.length === 1;

    recordResult(
      "Concurrency Safety",
      "Concurrent votes from two users saved atomically with no lost updates",
      "Both votes persisted: Alpha=1, Beta=1",
      `Alice status: ${concResAlice.status}, Bob status: ${concResBob.status}, Alpha: ${pAlpha?.votes?.length}, Beta: ${pBeta?.votes?.length}`,
      bothSucceeded && noLostUpdates,
    );

    // ----------------------------------------------------
    // TEST 7: Poll Ending Authorization & Rejection of Unauthorized End
    // ----------------------------------------------------
    await resetAll();
    // Bob (not creator) attempts to end Alice's poll
    const bobEndRes = await request(app)
      .post(`/api/v1/messages/${pollMessageId}/poll/close`)
      .set("Cookie", bob.cookies);

    recordResult(
      "Poll Ending Permissions",
      "Non-creator (Bob) rejected from ending Alice's poll",
      "403 Forbidden",
      `Status: ${bobEndRes.status}`,
      bobEndRes.status === 403,
    );

    // Alice (creator) ends poll via /close or /end alias
    await resetAll();
    const bobEndSocketPromise = waitForEvent(bob.socket, "pollUpdated");

    const aliceEndRes = await request(app)
      .post(`/api/v1/messages/${pollMessageId}/poll/end`)
      .set("Cookie", alice.cookies);

    const endPollData = aliceEndRes.body?.data?.poll;
    const endPassed =
      aliceEndRes.status === 200 &&
      (endPollData?.isClosed === true || endPollData?.isEnded === true) &&
      Boolean(endPollData?.endedAt || endPollData?.closedAt);

    recordResult(
      "Poll Ending",
      "Creator (Alice) ends poll successfully",
      "200 OK, isClosed=true, isEnded=true, endedAt recorded",
      `Status: ${aliceEndRes.status}, isEnded: ${endPollData?.isEnded}, endedAt: ${endPollData?.endedAt}`,
      endPassed,
    );

    const bobEndSocket = await bobEndSocketPromise;
    recordResult(
      "Socket Synchronization",
      "Bob receives real-time pollUpdated event when poll is ended",
      "pollUpdated event received with isClosed=true",
      `Received: ${bobEndSocket.received}`,
      bobEndSocket.received && (bobEndSocket.data?.poll?.isClosed || bobEndSocket.data?.poll?.isEnded),
    );

    // ----------------------------------------------------
    // TEST 8: Rejection of Votes on Ended Poll
    // ----------------------------------------------------
    await resetAll();
    const voteEndedRes = await request(app)
      .post(`/api/v1/messages/${pollMessageId}/poll/vote`)
      .set("Cookie", bob.cookies)
      .send({ optionIds: [optionMaybeId] });

    recordResult(
      "Ended Poll Protection",
      "Vote rejected when poll is ended",
      "400 Bad Request",
      `Status: ${voteEndedRes.status}, Message: ${voteEndedRes.body?.message}`,
      voteEndedRes.status === 400,
    );

    // ----------------------------------------------------
    // TEST 9: Non-Participant Access Control
    // ----------------------------------------------------
    await resetAll();
    const davidVoteRes = await request(app)
      .post(`/api/v1/messages/${concMsgId}/poll/vote`)
      .set("Cookie", david.cookies)
      .send({ optionIds: [optAlpha] });

    recordResult(
      "Non-Participant Security",
      "Third party (David) rejected from voting on 1:1 chat poll",
      "403 Forbidden",
      `Status: ${davidVoteRes.status}`,
      davidVoteRes.status === 403,
    );

    // ----------------------------------------------------
    // TEST 10: Regression Check on Normal Direct Messaging
    // ----------------------------------------------------
    await resetAll();
    const normalMsgRes = await request(app)
      .post(`/api/v1/messages/send/${bobId}`)
      .set("Cookie", alice.cookies)
      .send({ text: "Checking normal chat compatibility" });

    recordResult(
      "Backward Compatibility",
      "Normal text messaging between Alice and Bob continues working",
      "201 Created with valid text and sender/receiver IDs",
      `Status: ${normalMsgRes.status}, ID: ${normalMsgRes.body?.data?.id}`,
      normalMsgRes.status === 201 && normalMsgRes.body?.data?.senderId === aliceId,
    );
  } finally {
    await teardownTestEnvironment(env);
  }

  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log("\n==================================================");
  console.log(`DIRECT POLL SUITE: Passed: ${passed} | Failed: ${failed}`);
  console.log("==================================================\n");

  if (failed > 0) {
    throw new Error(`Direct poll test suite failed with ${failed} failure(s).`);
  }
}

runDirectPollTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
