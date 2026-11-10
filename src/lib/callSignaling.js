import crypto from "crypto";
import mongoose from "mongoose";
import User from "../models/users.model.js";
import { assertCanMessage } from "../utils/chat-guard.js";
import { safeHandler } from "../utils/socket-safe.js";
import { socketLimiter } from "../utils/socket-rate-limit.js";
import { SOCKET_RATE_LIMITS } from "../constants/shared/rate-limit.constants.js";
import {
  CALL_STATUS,
  CALL_LIFECYCLE_STATE,
  CALL_SOCKET_EVENTS,
  CALL_LIMITS,
  CALL_RING_TIMEOUT_MS,
} from "../constants/calling/call.constants.js";
import {
  validateSdp,
  validateIceCandidate,
  validateMediaPayload,
} from "../utils/webrtc-validator.js";
import { createCallRecord } from "../services/calls/call.service.js";

const RING_TIMEOUT_MS = CALL_RING_TIMEOUT_MS || CALL_LIMITS.RING_TIMEOUT_MS;

const calls = new Map();
const userCall = new Map();

export const isUserInCall = (userId) => userCall.has(String(userId));

export const getActiveCall = (callId) => calls.get(String(callId)) || null;

/**
 * Atomic transition for the 1-to-1 call state machine.
 */
const transitionCallState = (call, nextState) => {
  if (!call || call.state === CALL_LIFECYCLE_STATE.ENDED) {
    return false;
  }

  if (nextState === CALL_LIFECYCLE_STATE.ACCEPTED) {
    if (call.state !== CALL_LIFECYCLE_STATE.RINGING) return false;
    call.state = CALL_LIFECYCLE_STATE.ACCEPTED;
    call.answeredAt = new Date();
    return true;
  }

  if (nextState === CALL_LIFECYCLE_STATE.ENDED) {
    call.state = CALL_LIFECYCLE_STATE.ENDED;
    return true;
  }

  return false;
};

async function finishCall(io, callId, { status, endedBy = null, reason = "" }) {
  const call = calls.get(callId);
  if (!call) return;

  if (!transitionCallState(call, CALL_LIFECYCLE_STATE.ENDED)) {
    return;
  }

  if (call.timer) {
    clearTimeout(call.timer);
    call.timer = null;
  }

  calls.delete(callId);
  userCall.delete(call.callerId);
  userCall.delete(call.receiverId);

  const endedAt = new Date();
  const duration = call.answeredAt
    ? Math.max(0, Math.round((endedAt - call.answeredAt) / 1000))
    : 0;

  let finalStatus = status;
  if (status === "ended") {
    finalStatus = call.answeredAt
      ? CALL_STATUS.COMPLETED
      : CALL_STATUS.CANCELLED;
  }

  const payload = {
    callId,
    status: finalStatus,
    reason,
    duration,
    endedBy: endedBy ? String(endedBy) : null,
  };

  io.to(call.callerId).emit(CALL_SOCKET_EVENTS.CALL_ENDED, payload);
  io.to(call.receiverId).emit(CALL_SOCKET_EVENTS.CALL_ENDED, payload);

  try {
    await createCallRecord({
      callId: call.callId,
      callerId: call.callerId,
      receiverId: call.receiverId,
      type: call.type,
      status: finalStatus,
      startedAt: call.startedAt,
      answeredAt: call.answeredAt || undefined,
      endedAt,
      duration,
      endedBy: endedBy || undefined,
    });
  } catch (err) {
    console.error("[call] history save failed:", err?.message || err);
  }
}

export function registerCallHandlers(
  io,
  socket,
  { isUserOnline, isBusy = () => false },
) {
  const userId = socket.data?.userId ? String(socket.data.userId) : null;
  if (!userId) return;

  const getCallFor = (callId) => {
    if (!callId) return null;
    const call = calls.get(String(callId));
    if (!call) return null;
    if (call.callerId !== userId && call.receiverId !== userId) return null;
    return call;
  };

  const getPeerDestination = (call) => {
    const isCaller = userId === call.callerId;
    const targetSocketId = isCaller
      ? call.receiverSocketId
      : call.callerSocketId;
    const peerUserId = isCaller ? call.receiverId : call.callerId;
    return targetSocketId || peerUserId;
  };

  socket.on(
    CALL_SOCKET_EVENTS.CALL_INVITE,
    safeHandler(CALL_SOCKET_EVENTS.CALL_INVITE, async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const to = payload?.to ? String(payload.to) : null;
        const type = payload?.type;

        if (
          !to ||
          !mongoose.Types.ObjectId.isValid(to) ||
          to === userId ||
          !["audio", "video"].includes(type)
        ) {
          return reply({ ok: false, reason: "invalid" });
        }

        if (
          !socketLimiter.consume(
            userId,
            CALL_SOCKET_EVENTS.CALL_INVITE,
            SOCKET_RATE_LIMITS.CALL_INVITE,
          )
        ) {
          return reply({ ok: false, reason: "rate_limited" });
        }

        const callee = await User.findById(to).select("status fullName").lean();
        if (!callee || callee.status === "suspended") {
          return reply({ ok: false, reason: "not-allowed" });
        }

        try {
          await assertCanMessage(userId, to);
        } catch {
          return reply({ ok: false, reason: "not-allowed" });
        }

        if (!isUserOnline(to)) return reply({ ok: false, reason: "offline" });
        if (
          isUserInCall(userId) ||
          isUserInCall(to) ||
          isBusy(userId) ||
          isBusy(to)
        ) {
          return reply({ ok: false, reason: "busy" });
        }

        const callId = crypto.randomUUID();
        const call = {
          callId,
          callerId: userId,
          receiverId: to,
          type,
          state: CALL_LIFECYCLE_STATE.RINGING,
          callerSocketId: socket.id,
          receiverSocketId: null,
          startedAt: new Date(),
          answeredAt: null,
          timer: null,
        };

        call.timer = setTimeout(() => {
          finishCall(io, callId, {
            status: CALL_STATUS.MISSED,
            reason: "no-answer",
          });
        }, RING_TIMEOUT_MS);

        calls.set(callId, call);
        userCall.set(userId, callId);
        userCall.set(to, callId);

        io.to(to).emit(CALL_SOCKET_EVENTS.CALL_INCOMING, {
          callId,
          from: userId,
          fromName: socket.data?.fullName || "User",
          type,
        });

        reply({ ok: true, callId });
      } catch (err) {
        console.error("[call] invite failed:", err?.message || err);
        reply({ ok: false, reason: "error" });
      }
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_ACCEPT,
    safeHandler(CALL_SOCKET_EVENTS.CALL_ACCEPT, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;
      const call = getCallFor(callId);

      if (!call || call.receiverId !== userId) {
        return reply({ ok: false, reason: "not-found" });
      }

      if (!transitionCallState(call, CALL_LIFECYCLE_STATE.ACCEPTED)) {
        return reply({ ok: false, reason: "already-ended" });
      }

      if (call.timer) {
        clearTimeout(call.timer);
        call.timer = null;
      }

      call.receiverSocketId = socket.id;

      socket.to(userId).emit(CALL_SOCKET_EVENTS.CALL_ANSWERED_ELSEWHERE, {
        callId,
      });

      const callerTarget = call.callerSocketId || call.callerId;
      io.to(callerTarget).emit(CALL_SOCKET_EVENTS.CALL_ACCEPTED, { callId });

      reply({ ok: true, callId });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_REJECT,
    safeHandler(CALL_SOCKET_EVENTS.CALL_REJECT, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;
      const call = getCallFor(callId);

      if (
        !call ||
        call.receiverId !== userId ||
        call.state !== CALL_LIFECYCLE_STATE.RINGING
      ) {
        return reply({ ok: false, reason: "invalid" });
      }

      finishCall(io, callId, {
        status: CALL_STATUS.REJECTED,
        endedBy: userId,
      });
      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_CANCEL,
    safeHandler(CALL_SOCKET_EVENTS.CALL_CANCEL, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;
      const call = getCallFor(callId);

      if (!call || call.callerId !== userId) {
        return reply({ ok: false, reason: "invalid" });
      }

      finishCall(io, callId, {
        status: CALL_STATUS.CANCELLED,
        endedBy: userId,
        reason: "cancelled",
      });
      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_END,
    safeHandler(CALL_SOCKET_EVENTS.CALL_END, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;
      const call = getCallFor(callId);

      if (!call) return reply({ ok: false, reason: "not-found" });

      finishCall(io, callId, {
        status: "ended",
        endedBy: userId,
      });
      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_OFFER,
    safeHandler(CALL_SOCKET_EVENTS.CALL_OFFER, (payload) => {
      if (!payload || typeof payload !== "object") return;
      const { callId, offer } = payload;
      const call = getCallFor(callId);
      if (!call) return;

      const validOffer = validateSdp(offer, "offer");
      if (!validOffer) return;

      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_OFFER, {
        callId,
        offer: validOffer,
      });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_ANSWER,
    safeHandler(CALL_SOCKET_EVENTS.CALL_ANSWER, (payload) => {
      if (!payload || typeof payload !== "object") return;
      const { callId, answer } = payload;
      const call = getCallFor(callId);
      if (!call) return;

      const validAnswer = validateSdp(answer, "answer");
      if (!validAnswer) return;

      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_ANSWER, {
        callId,
        answer: validAnswer,
      });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_ICE,
    safeHandler(CALL_SOCKET_EVENTS.CALL_ICE, (payload) => {
      if (!payload || typeof payload !== "object") return;
      const { callId, candidate } = payload;
      const call = getCallFor(callId);
      if (!call) return;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_ICE,
          SOCKET_RATE_LIMITS.CALL_ICE,
        )
      ) {
        return;
      }

      const validCand = validateIceCandidate(candidate);
      if (!validCand) return;

      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_ICE, {
        callId,
        candidate: validCand,
      });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_MEDIA,
    safeHandler(CALL_SOCKET_EVENTS.CALL_MEDIA, (payload) => {
      if (!payload || typeof payload !== "object") return;
      const { callId } = payload;
      const call = getCallFor(callId);
      if (!call) return;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_MEDIA,
          SOCKET_RATE_LIMITS.CALL_MEDIA,
        )
      ) {
        return;
      }

      const media = validateMediaPayload(payload);
      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_MEDIA, {
        callId,
        audio: media.audio,
        video: media.video,
      });
    }),
  );

  socket.on(
    "disconnect",
    safeHandler("call:disconnect", async () => {
      socketLimiter.reset(userId);
      const callId = userCall.get(userId);
      const call = callId && calls.get(callId);
      if (!call) return;

      const isCallSocket =
        call.callerSocketId === socket.id ||
        call.receiverSocketId === socket.id;

      if (isCallSocket) {
        finishCall(io, callId, {
          status: "ended",
          endedBy: userId,
          reason: "disconnected",
        });
      } else if (
        call.receiverId === userId &&
        call.state === CALL_LIFECYCLE_STATE.RINGING
      ) {
        try {
          const remainingSockets = await io.in(String(userId)).fetchSockets();
          const otherSockets = remainingSockets.filter(
            (s) => s.id !== socket.id,
          );
          if (otherSockets.length === 0) {
            finishCall(io, callId, {
              status: CALL_STATUS.MISSED,
              endedBy: userId,
              reason: "callee-disconnected",
            });
          }
        } catch (_err) {
          // If check fails, fallback to keeping call alive until timeout
        }
      }
    }),
  );
}
