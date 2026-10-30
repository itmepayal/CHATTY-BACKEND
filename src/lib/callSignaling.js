import crypto from "crypto";
import Call from "../models/call.model.js";
import { assertCanMessage } from "../utils/chat-guard.js";
import { CALL_RING_TIMEOUT_MS } from "../constants/constants.js";

const RING_TIMEOUT_MS = CALL_RING_TIMEOUT_MS;

const calls = new Map();
const userCall = new Map();

export const isUserInCall = (userId) => userCall.has(String(userId));

async function finishCall(io, callId, { status, endedBy = null, reason = "" }) {
  const call = calls.get(callId);
  if (!call) return;

  clearTimeout(call.timer);
  calls.delete(callId);
  userCall.delete(call.callerId);
  userCall.delete(call.receiverId);

  const endedAt = new Date();
  const duration = call.answeredAt
    ? Math.max(0, Math.round((endedAt - call.answeredAt) / 1000))
    : 0;

  const finalStatus =
    status === "ended" ? (call.answeredAt ? "completed" : "cancelled") : status;

  const payload = {
    callId,
    status: finalStatus,
    reason,
    duration,
    endedBy: endedBy ? String(endedBy) : null,
  };

  io.to(call.callerId).emit("call:ended", payload);
  io.to(call.receiverId).emit("call:ended", payload);

  try {
    await Call.create({
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
  const userId = socket.data.userId;

  const getCallFor = (callId) => {
    const call = calls.get(callId);
    if (!call) return null;
    if (call.callerId !== userId && call.receiverId !== userId) return null;
    return call;
  };

  const peerSocketId = (call) =>
    userId === call.callerId ? call.receiverSocketId : call.callerSocketId;

  socket.on("call:invite", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => { };
    try {
      const to = payload?.to;
      const type = payload?.type;

      if (!to || typeof to !== "string" || to === userId) {
        return reply({ ok: false, reason: "invalid" });
      }
      if (!["audio", "video"].includes(type)) {
        return reply({ ok: false, reason: "invalid" });
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
        callerSocketId: socket.id,
        receiverSocketId: null,
        startedAt: new Date(),
        answeredAt: null,
        timer: null,
      };

      call.timer = setTimeout(() => {
        finishCall(io, callId, { status: "missed", reason: "no-answer" });
      }, RING_TIMEOUT_MS);

      calls.set(callId, call);
      userCall.set(userId, callId);
      userCall.set(to, callId);

      io.to(to).emit("call:incoming", {
        callId,
        from: userId,
        fromName: socket.data.fullName,
        type,
      });

      reply({ ok: true, callId });
    } catch (err) {
      console.error("[call] invite failed:", err?.message || err);
      reply({ ok: false, reason: "error" });
    }
  });

  socket.on("call:accept", ({ callId } = {}) => {
    const call = getCallFor(callId);
    if (!call || call.receiverId !== userId || call.answeredAt) return;

    clearTimeout(call.timer);
    call.answeredAt = new Date();
    call.receiverSocketId = socket.id;

    socket.to(userId).emit("call:answered-elsewhere", { callId });

    io.to(call.callerSocketId).emit("call:accepted", { callId });
  });

  socket.on("call:reject", ({ callId } = {}) => {
    const call = getCallFor(callId);
    if (!call || call.receiverId !== userId || call.answeredAt) return;
    finishCall(io, callId, { status: "rejected", endedBy: userId });
  });

  socket.on("call:end", ({ callId } = {}) => {
    const call = getCallFor(callId);
    if (!call) return;
    finishCall(io, callId, { status: "ended", endedBy: userId });
  });

  socket.on("call:offer", ({ callId, offer } = {}) => {
    const call = getCallFor(callId);
    const target = call && peerSocketId(call);
    if (!target || !offer) return;
    io.to(target).emit("call:offer", { callId, offer });
  });

  socket.on("call:answer", ({ callId, answer } = {}) => {
    const call = getCallFor(callId);
    const target = call && peerSocketId(call);
    if (!target || !answer) return;
    io.to(target).emit("call:answer", { callId, answer });
  });

  socket.on("call:ice", ({ callId, candidate } = {}) => {
    const call = getCallFor(callId);
    const target = call && peerSocketId(call);
    if (!target || !candidate) return;
    io.to(target).emit("call:ice", { callId, candidate });
  });

  socket.on("call:media", ({ callId, audio, video } = {}) => {
    const call = getCallFor(callId);
    const target = call && peerSocketId(call);
    if (!target) return;
    io.to(target).emit("call:media", {
      callId,
      audio: Boolean(audio),
      video: Boolean(video),
    });
  });

  socket.on("disconnect", () => {
    const callId = userCall.get(userId);
    const call = callId && calls.get(callId);
    if (!call) return;

    const isCallSocket =
      call.callerSocketId === socket.id || call.receiverSocketId === socket.id;

    if (isCallSocket) {
      finishCall(io, callId, {
        status: "ended",
        endedBy: userId,
        reason: "disconnected",
      });
    }
  });
}
