import crypto from "crypto";
import mongoose from "mongoose";
import User from "../../users/models/users.model.js";
import Contact from "../../contacts/models/contact.model.js";
import { assertCanMessage } from "../../messaging/utils/chat-guard.js";
import { safeHandler } from "../../../infrastructure/socket/socket-safe.js";
import { socketLimiter } from "../../../infrastructure/socket/socket-rate-limit.js";
import { SOCKET_RATE_LIMITS } from "../../../shared/constants/rate-limit.constants.js";
import {
  CALL_STATUS,
  CALL_LIFECYCLE_STATE,
  CALL_SOCKET_EVENTS,
  CALL_LIMITS,
  CALL_RING_TIMEOUT_MS,
  CALL_REACTIONS,
} from "../constants/call.constants.js";
import {
  validateSdp,
  validateIceCandidate,
  validateMediaPayload,
  isValidCallId,
  isValidQuality,
  sanitizeReason,
} from "./webrtc-validator.js";
import { createCallRecord } from "../services/call.service.js";
import * as notificationService from "../../notifications/services/notification.service.js";

const RING_TIMEOUT_MS = CALL_RING_TIMEOUT_MS || CALL_LIMITS.RING_TIMEOUT_MS;

const calls = new Map();
const userCall = new Map();
const targetCooldowns = new Map();

export const resetTargetCooldowns = () => {
  targetCooldowns.clear();
};
if (typeof socketLimiter.onReset === "function") {
  socketLimiter.onReset(resetTargetCooldowns);
}

function checkTargetCooldown(callerId, targetId) {
  const now = Date.now();
  const key = `${callerId}:${targetId}`;
  let timestamps = targetCooldowns.get(key) || [];
  timestamps = timestamps.filter((t) => now - t < 20000);
  if (timestamps.length >= 4) {
    return false;
  }
  timestamps.push(now);
  targetCooldowns.set(key, timestamps);
  return true;
}

export const isUserInCall = (userId) => userCall.has(String(userId));

export const getActiveCall = (callId) => calls.get(String(callId)) || null;

export const calculateActiveDurationSec = (call) => {
  if (!call || !call.answeredAt) return 0;
  let ms = call.activeDurationMs || 0;
  if (
    (call.state === CALL_LIFECYCLE_STATE.ACTIVE ||
      call.state === CALL_LIFECYCLE_STATE.ACCEPTED) &&
    call.lastActiveStartTime
  ) {
    ms += Math.max(0, Date.now() - call.lastActiveStartTime);
  }
  return Math.max(0, Math.round(ms / 1000));
};

/**
 * Helper to compute authoritative total hold duration in seconds.
 */
export const calculateTotalHoldDurationSec = (call) => {
  if (!call) return 0;
  let ms = call.accumulatedHoldMs || 0;
  if (call.state === CALL_LIFECYCLE_STATE.HELD && call.holdStartTime) {
    ms += Math.max(0, Date.now() - call.holdStartTime);
  }
  return Math.max(0, Math.round(ms / 1000));
};

/**
 * Helper to compute current hold duration in seconds.
 */
export const calculateCurrentHoldDurationSec = (call) => {
  if (
    !call ||
    call.state !== CALL_LIFECYCLE_STATE.HELD ||
    !call.holdStartTime
  ) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - call.holdStartTime) / 1000));
};

const VALID_CALL_TRANSITIONS = {
  [CALL_LIFECYCLE_STATE.IDLE]: [
    CALL_LIFECYCLE_STATE.INITIATING,
    CALL_LIFECYCLE_STATE.RINGING,
  ],
  [CALL_LIFECYCLE_STATE.INITIATING]: [
    CALL_LIFECYCLE_STATE.RINGING,
    CALL_LIFECYCLE_STATE.CANCELLED,
    CALL_LIFECYCLE_STATE.BUSY,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.RINGING]: [
    CALL_LIFECYCLE_STATE.ACCEPTING,
    CALL_LIFECYCLE_STATE.ACCEPTED,
    CALL_LIFECYCLE_STATE.CONNECTING,
    CALL_LIFECYCLE_STATE.CONNECTED,
    CALL_LIFECYCLE_STATE.ACTIVE,
    CALL_LIFECYCLE_STATE.REJECTED,
    CALL_LIFECYCLE_STATE.CANCELLED,
    CALL_LIFECYCLE_STATE.BUSY,
    CALL_LIFECYCLE_STATE.MISSED,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.ACCEPTING]: [
    CALL_LIFECYCLE_STATE.ACCEPTED,
    CALL_LIFECYCLE_STATE.CONNECTING,
    CALL_LIFECYCLE_STATE.CONNECTED,
    CALL_LIFECYCLE_STATE.ACTIVE,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.ACCEPTED]: [
    CALL_LIFECYCLE_STATE.CONNECTING,
    CALL_LIFECYCLE_STATE.CONNECTED,
    CALL_LIFECYCLE_STATE.ACTIVE,
    CALL_LIFECYCLE_STATE.HELD,
    CALL_LIFECYCLE_STATE.RECONNECTING,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.CONNECTING]: [
    CALL_LIFECYCLE_STATE.CONNECTED,
    CALL_LIFECYCLE_STATE.ACTIVE,
    CALL_LIFECYCLE_STATE.RECONNECTING,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.CONNECTED]: [
    CALL_LIFECYCLE_STATE.ACTIVE,
    CALL_LIFECYCLE_STATE.HELD,
    CALL_LIFECYCLE_STATE.RECONNECTING,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.ACTIVE]: [
    CALL_LIFECYCLE_STATE.HELD,
    CALL_LIFECYCLE_STATE.RECONNECTING,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.HELD]: [
    CALL_LIFECYCLE_STATE.ACTIVE,
    CALL_LIFECYCLE_STATE.CONNECTED,
    CALL_LIFECYCLE_STATE.RECONNECTING,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  [CALL_LIFECYCLE_STATE.RECONNECTING]: [
    CALL_LIFECYCLE_STATE.ACTIVE,
    CALL_LIFECYCLE_STATE.CONNECTED,
    CALL_LIFECYCLE_STATE.HELD,
    CALL_LIFECYCLE_STATE.FAILED,
    CALL_LIFECYCLE_STATE.ENDED,
  ],
  // Terminal states cannot transition further
  [CALL_LIFECYCLE_STATE.REJECTED]: [],
  [CALL_LIFECYCLE_STATE.CANCELLED]: [],
  [CALL_LIFECYCLE_STATE.BUSY]: [],
  [CALL_LIFECYCLE_STATE.MISSED]: [],
  [CALL_LIFECYCLE_STATE.FAILED]: [],
  [CALL_LIFECYCLE_STATE.ENDED]: [],
};

const isTerminalState = (state) =>
  [
    CALL_LIFECYCLE_STATE.ENDED,
    CALL_LIFECYCLE_STATE.REJECTED,
    CALL_LIFECYCLE_STATE.CANCELLED,
    CALL_LIFECYCLE_STATE.MISSED,
    CALL_LIFECYCLE_STATE.BUSY,
    CALL_LIFECYCLE_STATE.FAILED,
  ].includes(state);

/**
 * Authoritative atomic transition for the 1-to-1 call state machine.
 */
const transitionCallState = (call, nextState) => {
  if (!call || isTerminalState(call.state)) {
    return false;
  }

  // Validate state transition table
  const allowedNext = VALID_CALL_TRANSITIONS[call.state];
  if (Array.isArray(allowedNext) && !allowedNext.includes(nextState)) {
    console.warn(
      `[call:state-machine:invalid] transition forbidden from=${call.state} to=${nextState} callId=${call.callId}`,
    );
    return false;
  }

  // Transition to ACTIVE / ACCEPTED / CONNECTED
  if (
    nextState === CALL_LIFECYCLE_STATE.ACCEPTED ||
    nextState === CALL_LIFECYCLE_STATE.ACTIVE ||
    nextState === CALL_LIFECYCLE_STATE.CONNECTED
  ) {
    if (call.state === CALL_LIFECYCLE_STATE.HELD) {
      // Transitioning from HELD to ACTIVE (Resume)
      if (call.holdStartTime) {
        call.accumulatedHoldMs =
          (call.accumulatedHoldMs || 0) +
          Math.max(0, Date.now() - call.holdStartTime);
        call.holdStartTime = null;
      }
      call.lastActiveStartTime = Date.now();
      call.heldBy = null;
      call.holdOwnerId = null;
      call.holdStartedAt = null;
      call.state = CALL_LIFECYCLE_STATE.ACTIVE;
      call.stateVersion = (call.stateVersion || 1) + 1;
      call.holdStateVersion = (call.holdStateVersion || 0) + 1;
      return true;
    }
    call.state = nextState;
    if (!call.answeredAt) {
      call.answeredAt = new Date();
    }
    call.lastActiveStartTime = Date.now();
    call.stateVersion = (call.stateVersion || 1) + 1;
    return true;
  }

  // Transition to HELD
  if (nextState === CALL_LIFECYCLE_STATE.HELD) {
    if (
      call.state !== CALL_LIFECYCLE_STATE.ACTIVE &&
      call.state !== CALL_LIFECYCLE_STATE.ACCEPTED &&
      call.state !== CALL_LIFECYCLE_STATE.CONNECTED
    ) {
      return false;
    }
    if (call.lastActiveStartTime) {
      call.activeDurationMs =
        (call.activeDurationMs || 0) +
        Math.max(0, Date.now() - call.lastActiveStartTime);
      call.lastActiveStartTime = null;
    }
    call.holdStartTime = Date.now();
    call.holdStartedAt = new Date();
    call.holdCycles = (call.holdCycles || 0) + 1;
    call.state = CALL_LIFECYCLE_STATE.HELD;
    call.stateVersion = (call.stateVersion || 1) + 1;
    call.holdStateVersion = (call.holdStateVersion || 0) + 1;
    return true;
  }

  // Transition to RECONNECTING / CONNECTING
  if (
    nextState === CALL_LIFECYCLE_STATE.RECONNECTING ||
    nextState === CALL_LIFECYCLE_STATE.CONNECTING
  ) {
    call.state = nextState;
    call.stateVersion = (call.stateVersion || 1) + 1;
    return true;
  }

  // Transition to Terminal States (ENDED, REJECTED, CANCELLED, MISSED, BUSY, FAILED)
  if (isTerminalState(nextState)) {
    if (call.state === CALL_LIFECYCLE_STATE.HELD && call.holdStartTime) {
      call.accumulatedHoldMs =
        (call.accumulatedHoldMs || 0) +
        Math.max(0, Date.now() - call.holdStartTime);
      call.holdStartTime = null;
    } else if (
      (call.state === CALL_LIFECYCLE_STATE.ACTIVE ||
        call.state === CALL_LIFECYCLE_STATE.ACCEPTED ||
        call.state === CALL_LIFECYCLE_STATE.CONNECTED) &&
      call.lastActiveStartTime
    ) {
      call.activeDurationMs =
        (call.activeDurationMs || 0) +
        Math.max(0, Date.now() - call.lastActiveStartTime);
      call.lastActiveStartTime = null;
    }
    call.state = nextState;
    call.stateVersion = (call.stateVersion || 1) + 1;
    return true;
  }

  return false;
};

async function finishCall(io, callId, { status, endedBy = null, reason = "" }) {
  const call = calls.get(callId);
  if (!call) return;

  let terminalLifecycleState = CALL_LIFECYCLE_STATE.ENDED;
  if (status === CALL_STATUS.REJECTED) {
    terminalLifecycleState = CALL_LIFECYCLE_STATE.REJECTED;
  } else if (status === CALL_STATUS.CANCELLED) {
    terminalLifecycleState = CALL_LIFECYCLE_STATE.CANCELLED;
  } else if (status === CALL_STATUS.MISSED) {
    terminalLifecycleState = CALL_LIFECYCLE_STATE.MISSED;
  } else if (status === CALL_STATUS.BUSY) {
    terminalLifecycleState = CALL_LIFECYCLE_STATE.BUSY;
  } else if (status === CALL_STATUS.FAILED) {
    terminalLifecycleState = CALL_LIFECYCLE_STATE.FAILED;
  }

  if (!transitionCallState(call, terminalLifecycleState)) {
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
  const totalDuration = call.answeredAt
    ? Math.max(0, Math.round((endedAt - call.answeredAt) / 1000))
    : 0;
  const holdDuration = Math.max(
    0,
    Math.round((call.accumulatedHoldMs || 0) / 1000),
  );
  const activeDuration = Math.max(0, totalDuration - holdDuration);

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
    duration: totalDuration,
    activeDuration,
    holdDuration,
    stateVersion: call.stateVersion,
    endedBy: endedBy ? String(endedBy) : null,
  };

  console.log(
    `[call:audit] action=call_ended callId=${callId} finalStatus=${finalStatus} reason=${reason || "none"} duration=${totalDuration} activeDuration=${activeDuration} holdDuration=${holdDuration} endedBy=${endedBy || "system"}`,
  );

  call.heldBy = null;
  call.holdOwnerId = null;
  call.holdStartedAt = null;

  io.to(String(call.callerId)).emit(CALL_SOCKET_EVENTS.CALL_ENDED, payload);
  io.to(String(call.receiverId)).emit(CALL_SOCKET_EVENTS.CALL_ENDED, payload);

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
      duration: totalDuration,
      activeDuration,
      holdDuration,
      holdCycles: call.holdCycles || 0,
      holdOwnerId: call.holdOwnerId || undefined,
      holdStartedAt: call.holdStartedAt || undefined,
      holdStateVersion: call.holdStateVersion || 0,
      endedBy: endedBy || undefined,
      endReason: reason || undefined,
    });
  } catch (err) {
    console.error("[call] history save failed:", err?.message || err);
  }

  if (!call.answeredAt) {
    try {
      User.findById(call.callerId)
        .select("fullName username")
        .lean()
        .then((callerUser) => {
          const callerName =
            callerUser?.fullName || callerUser?.username || "Someone";
          const isVideo = call.type === "video";
          notificationService
            .dispatchNotification({
              recipientId: call.receiverId,
              senderId: call.callerId,
              category: "call",
              type: isVideo ? "call_missed_video" : "call_missed_voice",
              title: isVideo ? "Missed video call" : "Missed voice call",
              body: `${callerName} called you`,
              data: {
                callId: call.callId,
                callerId: String(call.callerId),
                callType: call.type,
              },
              dedupKey: `call_missed_${call.callId}`,
            })
            .catch(() => {});
        })
        .catch(() => {});
    } catch (_e) {}
  }
}

export function registerCallHandlers(
  io,
  socket,
  { isUserOnline, isBusy = () => false },
) {
  const userId = socket.data?.userId ? String(socket.data.userId) : null;
  if (!userId) return;

  const getCallFor = (callId, action = "call") => {
    if (!isValidCallId(callId)) {
      console.warn(
        `[call:audit:unauthorized] invalid-callId action=${action} userId=${userId}`,
      );
      return null;
    }
    const call = calls.get(String(callId));
    if (!call) return null;
    if (call.callerId !== userId && call.receiverId !== userId) {
      console.warn(
        `[call:audit:unauthorized] non-participant action=${action} userId=${userId} callId=${callId}`,
      );
      return null;
    }
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

        if (isUserInCall(userId) || isBusy(userId)) {
          return reply({ ok: false, reason: "busy" });
        }

        if (!checkTargetCooldown(userId, to)) {
          return reply({ ok: false, reason: "rate_limited" });
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

        const callee = await User.findById(to)
          .select("status fullName silenceUnknownCallers")
          .lean();
        if (!callee || callee.status === "suspended") {
          return reply({ ok: false, reason: "not-allowed" });
        }

        if (!isUserOnline(to)) return reply({ ok: false, reason: "offline" });

        try {
          await assertCanMessage(userId, to);
        } catch {
          return reply({ ok: false, reason: "not-allowed" });
        }

        let isSilenced = false;
        if (callee?.silenceUnknownCallers) {
          const isSaved = await Contact.exists({
            ownerId: to,
            contactId: userId,
          });
          if (!isSaved) {
            isSilenced = true;
          }
        }

        const isCalleeInCall = isUserInCall(to) || isBusy(to);
        let isWaitingCall = false;

        if (isCalleeInCall) {
          // Check if callee is actively in an ACCEPTED/CONNECTED call vs still RINGING
          const calleeActiveCall = Array.from(calls.values()).find(
            (c) =>
              (c.callerId === to || c.receiverId === to) &&
              (c.state === CALL_LIFECYCLE_STATE.ACCEPTED ||
                c.state === CALL_LIFECYCLE_STATE.ACTIVE ||
                c.state === CALL_LIFECYCLE_STATE.CONNECTED ||
                c.state === CALL_LIFECYCLE_STATE.HELD),
          );
          if (!calleeActiveCall) {
            // Callee is already ringing with another call -> busy
            return reply({ ok: false, reason: "busy" });
          }

          // Check if callee already has a pending waiting call
          const alreadyHasWaiting = Array.from(calls.values()).some(
            (c) =>
              c.receiverId === to &&
              c.isWaiting &&
              c.state === CALL_LIFECYCLE_STATE.RINGING,
          );
          if (alreadyHasWaiting) {
            return reply({ ok: false, reason: "busy" });
          }
          isWaitingCall = true;
        }

        const callId = crypto.randomUUID();
        const call = {
          callId,
          callerId: userId,
          receiverId: to,
          type,
          state: CALL_LIFECYCLE_STATE.RINGING,
          stateVersion: 1,
          callerSocketId: socket.id,
          receiverSocketId: null,
          startedAt: new Date(),
          answeredAt: null,
          timer: null,
          isWaiting: isWaitingCall,
          heldBy: null,
          holdOwnerId: null,
          holdStartedAt: null,
          holdStartTime: null,
          holdStateVersion: 0,
          lastActiveStartTime: null,
          accumulatedHoldMs: 0,
          activeDurationMs: 0,
          holdCycles: 0,
        };

        call.timer = setTimeout(() => {
          finishCall(io, callId, {
            status: CALL_STATUS.MISSED,
            reason: "no-answer",
          });
        }, RING_TIMEOUT_MS);

        calls.set(callId, call);
        userCall.set(userId, callId);
        if (!isWaitingCall) {
          userCall.set(to, callId);
        }

        console.log(
          `[call:audit] action=call_initiated callId=${callId} callerId=${userId} receiverId=${to} type=${type} isWaiting=${isWaitingCall}`,
        );

        if (isWaitingCall) {
          io.to(to).emit(CALL_SOCKET_EVENTS.CALL_WAITING, {
            callId,
            from: userId,
            fromName: socket.data?.fullName || "User",
            avatar: socket.data?.avatar || "",
            type,
          });
        } else {
          io.to(to).emit(CALL_SOCKET_EVENTS.CALL_INCOMING, {
            callId,
            from: userId,
            fromName: socket.data?.fullName || "User",
            type,
            silenced: isSilenced,
          });
        }

        reply({ ok: true, callId, waiting: isWaitingCall });
      } catch (err) {
        console.error("[call] invite failed:", err?.message || err);
        reply({ ok: false, reason: "error" });
      }
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_ACCEPT,
    safeHandler(CALL_SOCKET_EVENTS.CALL_ACCEPT, async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_ACCEPT,
          SOCKET_RATE_LIMITS.CALL_ACCEPT,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const call = getCallFor(callId, "accept");
      if (!call || call.receiverId !== userId) {
        return reply({ ok: false, reason: "not-found" });
      }

      // Idempotent duplicate acceptance: safely reject if already accepted by this receiver
      if (call.state === CALL_LIFECYCLE_STATE.ACCEPTED) {
        return reply({ ok: false, reason: "already-accepted" });
      }

      // If accepting a waiting call while already in an active call, terminate the active call cleanly
      const currentActiveCallId = userCall.get(userId);
      if (currentActiveCallId && currentActiveCallId !== callId) {
        await finishCall(io, currentActiveCallId, {
          status: "ended",
          endedBy: userId,
          reason: "switched-to-waiting-call",
        });
      }

      if (!transitionCallState(call, CALL_LIFECYCLE_STATE.ACCEPTED)) {
        return reply({ ok: false, reason: "already-ended" });
      }

      if (call.timer) {
        clearTimeout(call.timer);
        call.timer = null;
      }

      call.isWaiting = false;
      userCall.set(userId, callId);
      call.receiverSocketId = socket.id;

      console.log(
        `[call:audit] action=call_accepted callId=${callId} userId=${userId}`,
      );

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
    safeHandler(CALL_SOCKET_EVENTS.CALL_REJECT, async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_REJECT,
          SOCKET_RATE_LIMITS.CALL_REJECT,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const declineReason = sanitizeReason(payload?.reason || "rejected");
      const call = getCallFor(callId, "reject");

      if (
        !call ||
        call.receiverId !== userId ||
        call.state !== CALL_LIFECYCLE_STATE.RINGING
      ) {
        return reply({ ok: false, reason: "invalid" });
      }

      console.log(
        `[call:audit] action=call_rejected callId=${callId} userId=${userId} reason=${declineReason}`,
      );

      await finishCall(io, callId, {
        status: CALL_STATUS.REJECTED,
        endedBy: userId,
        reason: declineReason,
      });
      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_HOLD,
    safeHandler(CALL_SOCKET_EVENTS.CALL_HOLD, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_HOLD,
          SOCKET_RATE_LIMITS.CALL_HOLD,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const call = getCallFor(callId, "hold");
      if (!call) {
        const rawCall = calls.get(String(callId));
        if (
          rawCall &&
          rawCall.callerId !== userId &&
          rawCall.receiverId !== userId
        ) {
          return reply({ ok: false, reason: "not-participant" });
        }
        return reply({ ok: false, reason: "not-found" });
      }

      if (call.state === CALL_LIFECYCLE_STATE.ENDED) {
        return reply({ ok: false, reason: "already-ended" });
      }

      // Check if already held
      if (call.state === CALL_LIFECYCLE_STATE.HELD) {
        const currentOwner = call.holdOwnerId || call.heldBy;
        if (currentOwner && String(currentOwner) === String(userId)) {
          return reply({
            ok: true,
            callId,
            state: CALL_LIFECYCLE_STATE.HELD,
            stateVersion: call.stateVersion,
            heldBy: call.heldBy,
            holdOwnerId: call.holdOwnerId || call.heldBy,
            holdStartedAt: call.holdStartedAt || null,
            holdStateVersion: call.holdStateVersion || 0,
            isHeld: true,
            reason: "already-held",
            idempotent: true,
          });
        } else {
          return reply({
            ok: false,
            reason: "ALREADY_HELD_BY_OTHER",
            message: "Call is already placed on hold by the other participant.",
            holdOwnerId: currentOwner || null,
          });
        }
      }

      if (
        call.state !== CALL_LIFECYCLE_STATE.ACTIVE &&
        call.state !== CALL_LIFECYCLE_STATE.ACCEPTED &&
        call.state !== CALL_LIFECYCLE_STATE.CONNECTED
      ) {
        return reply({ ok: false, reason: "invalid-state", state: call.state });
      }

      call.heldBy = userId;
      call.holdOwnerId = userId;
      if (!transitionCallState(call, CALL_LIFECYCLE_STATE.HELD)) {
        return reply({ ok: false, reason: "transition-failed" });
      }

      const holdPayload = {
        callId,
        action: "hold",
        actorId: userId,
        heldBy: userId,
        holdOwnerId: userId,
        holdStartedAt: call.holdStartedAt,
        holdStateVersion: call.holdStateVersion,
        isHeld: true,
        state: CALL_LIFECYCLE_STATE.HELD,
        stateVersion: call.stateVersion,
        timestamp: Date.now(),
        activeDurationSec: calculateActiveDurationSec(call),
        totalHoldDurationSec: calculateTotalHoldDurationSec(call),
      };

      console.log(
        `[call:audit] action=call_held callId=${callId} userId=${userId} stateVersion=${call.stateVersion}`,
      );

      // Synchronize both participants across all their connected devices
      io.to(String(call.callerId)).emit(
        CALL_SOCKET_EVENTS.CALL_HELD,
        holdPayload,
      );
      io.to(String(call.receiverId)).emit(
        CALL_SOCKET_EVENTS.CALL_HELD,
        holdPayload,
      );
      io.to(String(call.callerId)).emit(
        CALL_SOCKET_EVENTS.CALL_STATE,
        holdPayload,
      );
      io.to(String(call.receiverId)).emit(
        CALL_SOCKET_EVENTS.CALL_STATE,
        holdPayload,
      );

      reply({ ok: true, ...holdPayload });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_RESUME,
    safeHandler(CALL_SOCKET_EVENTS.CALL_RESUME, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_RESUME,
          SOCKET_RATE_LIMITS.CALL_RESUME,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const call = getCallFor(callId, "resume");
      if (!call) {
        const rawCall = calls.get(String(callId));
        if (
          rawCall &&
          rawCall.callerId !== userId &&
          rawCall.receiverId !== userId
        ) {
          return reply({ ok: false, reason: "not-participant" });
        }
        return reply({ ok: false, reason: "not-found" });
      }

      if (call.state === CALL_LIFECYCLE_STATE.ENDED) {
        return reply({ ok: false, reason: "already-ended" });
      }

      // Idempotency: if already active/accepted/connected, return success without re-transitioning
      if (
        call.state === CALL_LIFECYCLE_STATE.ACTIVE ||
        call.state === CALL_LIFECYCLE_STATE.ACCEPTED ||
        call.state === CALL_LIFECYCLE_STATE.CONNECTED
      ) {
        return reply({
          ok: true,
          callId,
          state: CALL_LIFECYCLE_STATE.ACTIVE,
          stateVersion: call.stateVersion,
          heldBy: null,
          holdOwnerId: null,
          isHeld: false,
          reason: "already-active",
          idempotent: true,
        });
      }

      if (call.state !== CALL_LIFECYCLE_STATE.HELD) {
        return reply({ ok: false, reason: "invalid-state", state: call.state });
      }

      // STRICT AUTHORIZATION CHECK: HOLD OWNER PERMISSION CONTROL
      const currentHoldOwner = call.holdOwnerId || call.heldBy;
      if (!currentHoldOwner || String(currentHoldOwner) !== String(userId)) {
        console.warn(
          `[call:audit:unauthorized] unauthorized_resume callId=${callId} requester=${userId} holdOwner=${currentHoldOwner}`,
        );
        return reply({
          ok: false,
          reason: "HOLD_OWNER_ONLY",
          message:
            "Only the participant who placed this call on hold can resume it.",
          holdOwnerId: currentHoldOwner || null,
        });
      }

      const previousHeldBy = call.heldBy;
      const previousHoldOwnerId = call.holdOwnerId;
      if (!transitionCallState(call, CALL_LIFECYCLE_STATE.ACTIVE)) {
        return reply({ ok: false, reason: "transition-failed" });
      }

      const resumePayload = {
        callId,
        action: "resume",
        actorId: userId,
        resumedBy: userId,
        previousHeldBy,
        previousHoldOwnerId,
        heldBy: null,
        holdOwnerId: null,
        isHeld: false,
        state: CALL_LIFECYCLE_STATE.ACTIVE,
        stateVersion: call.stateVersion,
        timestamp: Date.now(),
        activeDurationSec: calculateActiveDurationSec(call),
        totalHoldDurationSec: calculateTotalHoldDurationSec(call),
      };

      console.log(
        `[call:audit] action=call_resumed callId=${callId} userId=${userId} stateVersion=${call.stateVersion}`,
      );

      // Synchronize both participants across all their connected devices
      io.to(String(call.callerId)).emit(
        CALL_SOCKET_EVENTS.CALL_RESUMED,
        resumePayload,
      );
      io.to(String(call.receiverId)).emit(
        CALL_SOCKET_EVENTS.CALL_RESUMED,
        resumePayload,
      );
      io.to(String(call.callerId)).emit(
        CALL_SOCKET_EVENTS.CALL_STATE,
        resumePayload,
      );
      io.to(String(call.receiverId)).emit(
        CALL_SOCKET_EVENTS.CALL_STATE,
        resumePayload,
      );

      reply({ ok: true, ...resumePayload });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_GET_STATE,
    safeHandler(CALL_SOCKET_EVENTS.CALL_GET_STATE, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_GET_STATE,
          SOCKET_RATE_LIMITS.CALL_GET_STATE,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const call = getCallFor(callId, "get-state");
      if (!call) {
        const rawCall = calls.get(String(callId));
        if (
          rawCall &&
          rawCall.callerId !== userId &&
          rawCall.receiverId !== userId
        ) {
          return reply({ ok: false, reason: "not-participant" });
        }
        return reply({ ok: false, reason: "not-found" });
      }

      const callState = {
        callId: call.callId,
        state: call.state,
        stateVersion: call.stateVersion,
        heldBy: call.heldBy,
        holdOwnerId: call.holdOwnerId || call.heldBy || null,
        holdStartedAt: call.holdStartedAt || null,
        holdStateVersion: call.holdStateVersion || 0,
        isHeld: call.state === CALL_LIFECYCLE_STATE.HELD,
        type: call.type,
        activeDurationSec: calculateActiveDurationSec(call),
        totalHoldDurationSec: calculateTotalHoldDurationSec(call),
        currentHoldDurationSec: calculateCurrentHoldDurationSec(call),
        screenSharingUserId: call.screenSharingUserId || null,
        isScreenSharing: Boolean(call.screenSharingUserId),
      };

      reply({
        ok: true,
        callState,
        ...callState,
      });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_RECONNECT,
    safeHandler(CALL_SOCKET_EVENTS.CALL_RECONNECT, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_RECONNECT,
          SOCKET_RATE_LIMITS.CALL_RECONNECT,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const call = getCallFor(callId, "reconnect");
      if (!call) return reply({ ok: false, reason: "not-found" });

      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_RECONNECT, { callId });
      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_QUALITY,
    safeHandler(CALL_SOCKET_EVENTS.CALL_QUALITY, (payload) => {
      if (!payload || typeof payload !== "object") return;
      const { callId, quality } = payload;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_QUALITY,
          SOCKET_RATE_LIMITS.CALL_QUALITY,
        )
      ) {
        return;
      }

      if (!isValidCallId(callId) || !isValidQuality(quality)) return;

      const call = getCallFor(callId, "quality");
      if (!call) return;

      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_QUALITY, {
        callId,
        quality,
      });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_CANCEL,
    safeHandler(CALL_SOCKET_EVENTS.CALL_CANCEL, async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_CANCEL,
          SOCKET_RATE_LIMITS.CALL_CANCEL,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const call = getCallFor(callId, "cancel");
      if (!call || call.callerId !== userId) {
        return reply({ ok: false, reason: "invalid" });
      }

      await finishCall(io, callId, {
        status: CALL_STATUS.CANCELLED,
        endedBy: userId,
        reason: "cancelled",
      });
      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_END,
    safeHandler(CALL_SOCKET_EVENTS.CALL_END, async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const callId = payload?.callId;

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_END,
          SOCKET_RATE_LIMITS.CALL_END,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) {
        return reply({ ok: false, reason: "invalid" });
      }

      const call = getCallFor(callId, "end");
      if (!call) return reply({ ok: false, reason: "not-found" });

      await finishCall(io, callId, {
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

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_OFFER,
          SOCKET_RATE_LIMITS.CALL_OFFER,
        )
      ) {
        return;
      }

      if (!isValidCallId(callId)) return;

      const call = getCallFor(callId, "offer");
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

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_ANSWER,
          SOCKET_RATE_LIMITS.CALL_ANSWER,
        )
      ) {
        return;
      }

      if (!isValidCallId(callId)) return;

      const call = getCallFor(callId, "answer");
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

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_ICE,
          SOCKET_RATE_LIMITS.CALL_ICE,
        )
      ) {
        return;
      }

      if (!isValidCallId(callId)) return;

      const call = getCallFor(callId, "ice");
      if (!call) return;

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

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_MEDIA,
          SOCKET_RATE_LIMITS.CALL_MEDIA,
        )
      ) {
        return;
      }

      if (!isValidCallId(callId)) return;

      const call = getCallFor(callId, "media");
      if (!call) return;

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
    CALL_SOCKET_EVENTS.CALL_REACTION,
    safeHandler(CALL_SOCKET_EVENTS.CALL_REACTION, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const { callId, reaction } = payload || {};

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_REACTION,
          SOCKET_RATE_LIMITS.CALL_REACTION,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) return reply({ ok: false, reason: "invalid" });
      const call = getCallFor(callId, "reaction");
      if (!call) return reply({ ok: false, reason: "not-found" });

      if (!CALL_REACTIONS.includes(reaction)) {
        return reply({ ok: false, reason: "invalid-reaction" });
      }

      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_REACTION, {
        callId,
        senderId: userId,
        reaction,
        timestamp: Date.now(),
      });

      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_CAPTION,
    safeHandler(CALL_SOCKET_EVENTS.CALL_CAPTION, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const { callId, text, isFinal, sourceLang } = payload || {};

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_CAPTION,
          SOCKET_RATE_LIMITS.CALL_CAPTION,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) return reply({ ok: false, reason: "invalid" });
      const call = getCallFor(callId, "caption");
      if (!call) return reply({ ok: false, reason: "not-found" });

      if (typeof text !== "string" || !text.trim()) {
        return reply({ ok: false, reason: "invalid-text" });
      }

      const sanitizedText = text.trim().slice(0, 500);
      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_CAPTION, {
        callId,
        senderId: userId,
        text: sanitizedText,
        isFinal: Boolean(isFinal),
        sourceLang: typeof sourceLang === "string" ? sourceLang.slice(0, 10) : "en",
        timestamp: Date.now(),
      });

      reply({ ok: true });
    }),
  );

  socket.on(
    CALL_SOCKET_EVENTS.CALL_SCREENSHARE,
    safeHandler(CALL_SOCKET_EVENTS.CALL_SCREENSHARE, (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      const { callId, isSharing } = payload || {};

      if (
        !socketLimiter.consume(
          userId,
          CALL_SOCKET_EVENTS.CALL_SCREENSHARE,
          SOCKET_RATE_LIMITS.CALL_SCREENSHARE,
        )
      ) {
        return reply({ ok: false, reason: "rate_limited" });
      }

      if (!isValidCallId(callId)) return reply({ ok: false, reason: "invalid" });
      const call = getCallFor(callId, "screenshare");
      if (!call) return reply({ ok: false, reason: "not-found" });

      const isCaller = String(call.callerId) === String(userId);
      const isReceiver = String(call.receiverId) === String(userId);
      if (!isCaller && !isReceiver) {
        return reply({ ok: false, reason: "not-authorized" });
      }

      // If user is stopping sharing, only the active sharer can stop it
      if (!isSharing && call.screenSharingUserId && String(call.screenSharingUserId) !== String(userId)) {
        return reply({ ok: false, reason: "not-authorized" });
      }

      call.screenSharingUserId = isSharing ? userId : null;

      const destination = getPeerDestination(call);
      io.to(destination).emit(CALL_SOCKET_EVENTS.CALL_SCREENSHARE, {
        callId,
        userId,
        isSharing: Boolean(isSharing),
      });

      reply({ ok: true, isSharing: Boolean(isSharing), screenSharingUserId: call.screenSharingUserId });
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
