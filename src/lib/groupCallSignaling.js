import crypto from "crypto";
import mongoose from "mongoose";
import Group from "../models/group.model.js";
import User from "../models/users.model.js";
import { isUserInCall } from "./callSignaling.js";
import { canViewProfilePhoto } from "../services/privacy/privacy-visibility.service.js";
import {
  CALL_STATUS,
  CALL_SOCKET_EVENTS,
  CALL_LIMITS,
} from "../constants/call.constants.js";
import {
  validateSdp,
  validateIceCandidate,
  validateMediaPayload,
} from "../utils/webrtc-validator.js";
import { createGroupCallRecord } from "../services/calls/group-call.service.js";
import { socketLimiter } from "../utils/socket-rate-limit.js";
import { SOCKET_RATE_LIMITS } from "../constants/rate-limit.constants.js";

const MAX_PARTICIPANTS = CALL_LIMITS.MAX_GROUP_CALL_PARTICIPANTS;
const RING_TIMEOUT_MS = CALL_LIMITS.GROUP_RING_TIMEOUT_MS;

const calls = new Map();
const userGroup = new Map();

export const isUserInGroupCall = (userId) => userGroup.has(String(userId));

export const getActiveGroupCall = (groupId) =>
  calls.get(String(groupId)) || null;

const isId = (id) => mongoose.Types.ObjectId.isValid(id);

const getProfile = async (userId, fallbackName) => {
  try {
    const u = await User.findById(userId).select("fullName avatar").lean();
    return {
      userId: String(userId),
      fullName: u?.fullName || fallbackName || "User",
      avatar: u?.avatar?.url || "",
    };
  } catch {
    return {
      userId: String(userId),
      fullName: fallbackName || "User",
      avatar: "",
    };
  }
};

async function finishCall(io, call, { status, reason = "" }) {
  if (!call || calls.get(call.groupId) !== call) return;

  if (call.timer) {
    clearTimeout(call.timer);
    call.timer = null;
  }

  calls.delete(call.groupId);
  for (const uid of call.participants.keys()) {
    userGroup.delete(uid);
  }

  const endedAt = new Date();
  const duration = call.connectedAt
    ? Math.max(0, Math.round((endedAt - call.connectedAt) / 1000))
    : 0;
  const finalStatus = call.everMulti ? CALL_STATUS.COMPLETED : status;

  const payload = {
    callId: call.callId,
    groupId: call.groupId,
    status: finalStatus,
    reason,
    duration,
  };

  for (const memberId of call.memberIds) {
    io.to(memberId).emit(CALL_SOCKET_EVENTS.GCALL_ENDED, payload);
  }

  try {
    await createGroupCallRecord({
      callId: call.callId,
      groupId: call.groupId,
      startedBy: call.startedBy,
      type: call.type,
      status: finalStatus,
      startedAt: call.startedAt,
      endedAt,
      duration,
      participants: [...call.everJoined],
      maxParticipants: call.maxParticipants,
    });
  } catch (err) {
    console.error("[gcall] history save failed:", err?.message || err);
  }
}

function removeParticipant(io, call, userId, reason = "left") {
  if (!call || !call.participants.has(userId)) return;

  call.participants.delete(userId);
  userGroup.delete(userId);

  for (const p of call.participants.values()) {
    io.to(p.socketId).emit(CALL_SOCKET_EVENTS.GCALL_PEER_LEFT, {
      callId: call.callId,
      userId,
      reason,
    });
  }

  if (call.participants.size === 0) {
    finishCall(io, call, { status: CALL_STATUS.CANCELLED, reason: "empty" });
  } else if (call.participants.size === 1 && call.everMulti) {
    finishCall(io, call, {
      status: CALL_STATUS.COMPLETED,
      reason: "everyone-left",
    });
  }
}

export const terminateGroupCallByGroup = (
  io,
  groupId,
  reason = "group-deleted",
) => {
  const call = calls.get(String(groupId));
  if (call && io) {
    finishCall(io, call, { status: CALL_STATUS.CANCELLED, reason });
  }
};

export const evictMemberFromGroupCall = (
  io,
  groupId,
  userId,
  reason = "member-removed",
) => {
  const call = calls.get(String(groupId));
  if (call && io) {
    removeParticipant(io, call, String(userId), reason);
  }
};

export function registerGroupCallHandlers(io, socket) {
  const userId = socket.data?.userId ? String(socket.data.userId) : null;
  if (!userId) return;

  const myCall = (callId) => {
    const gid = userGroup.get(userId);
    const call = gid && calls.get(gid);
    if (!call || call.callId !== callId) return null;
    if (call.participants.get(userId)?.socketId !== socket.id) return null;
    return call;
  };

  socket.on(CALL_SOCKET_EVENTS.GCALL_START, async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      const { groupId, type } = payload || {};
      if (!isId(groupId) || !["audio", "video"].includes(type)) {
        return reply({ ok: false, reason: "invalid" });
      }
      const gid = String(groupId);

      const group = await Group.findOne({
        _id: gid,
        "members.userId": userId,
      })
        .select("name members.userId")
        .lean();
      if (!group) return reply({ ok: false, reason: "not-member" });

      const existing = calls.get(gid);
      if (existing) {
        return reply({
          ok: false,
          reason: "active",
          callId: existing.callId,
          type: existing.type,
        });
      }

      if (isUserInCall(userId) || isUserInGroupCall(userId)) {
        return reply({ ok: false, reason: "busy" });
      }

      const profile = await getProfile(userId, socket.data?.fullName);

      const callId = crypto.randomUUID();
      const call = {
        callId,
        groupId: gid,
        groupName: group.name,
        type,
        startedBy: userId,
        startedAt: new Date(),
        connectedAt: null,
        everMulti: false,
        everJoined: new Set([userId]),
        maxParticipants: 1,
        memberIds: group.members.map((m) => String(m.userId)),
        participants: new Map([
          [
            userId,
            {
              socketId: socket.id,
              fullName: profile.fullName,
              avatar: profile.avatar,
            },
          ],
        ]),
        timer: null,
      };

      call.timer = setTimeout(() => {
        finishCall(io, call, {
          status: CALL_STATUS.MISSED,
          reason: "no-answer",
        });
      }, RING_TIMEOUT_MS);

      calls.set(gid, call);
      userGroup.set(userId, gid);

      const incoming = {
        callId,
        groupId: gid,
        groupName: group.name,
        type,
        starter: profile,
      };

      for (const memberId of call.memberIds) {
        if (memberId !== userId) {
          const canView = await canViewProfilePhoto(memberId, userId);
          io.to(memberId).emit(CALL_SOCKET_EVENTS.GCALL_INCOMING, {
            ...incoming,
            starter: {
              ...profile,
              avatar: canView ? profile.avatar : "",
            },
          });
        }
      }

      reply({ ok: true, callId, me: profile });
    } catch (err) {
      console.error("[gcall] start failed:", err?.message || err);
      reply({ ok: false, reason: "error" });
    }
  });

  socket.on(CALL_SOCKET_EVENTS.GCALL_JOIN, async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    try {
      const gid = String(payload?.groupId || "");
      if (!isId(gid)) return reply({ ok: false, reason: "invalid" });

      const call = calls.get(gid);
      if (!call) return reply({ ok: false, reason: "no-call" });

      const isMember = await Group.exists({
        _id: gid,
        "members.userId": userId,
      });
      if (!isMember) {
        return reply({ ok: false, reason: "not-member" });
      }

      if (call.participants.has(userId)) {
        const currentP = call.participants.get(userId);
        if (currentP.socketId === socket.id) {
          return reply({ ok: false, reason: "already-joined" });
        }
        currentP.socketId = socket.id;
      } else {
        if (isUserInCall(userId) || isUserInGroupCall(userId)) {
          return reply({ ok: false, reason: "busy" });
        }
        if (call.participants.size >= MAX_PARTICIPANTS) {
          return reply({ ok: false, reason: "full" });
        }

        const profile = await getProfile(userId, socket.data?.fullName);

        if (call.participants.size >= MAX_PARTICIPANTS) {
          return reply({ ok: false, reason: "unavailable" });
        }

        const peers = [...call.participants.entries()].map(([uid, p]) => ({
          userId: uid,
          fullName: p.fullName,
          avatar: p.avatar,
        }));

        call.participants.set(userId, {
          socketId: socket.id,
          fullName: profile.fullName,
          avatar: profile.avatar,
        });
        userGroup.set(userId, gid);
        call.everJoined.add(userId);
        call.maxParticipants = Math.max(
          call.maxParticipants,
          call.participants.size,
        );

        if (!call.everMulti) {
          call.everMulti = true;
          call.connectedAt = new Date();
          if (call.timer) {
            clearTimeout(call.timer);
            call.timer = null;
          }
        }

        socket.to(userId).emit(CALL_SOCKET_EVENTS.GCALL_JOINED_ELSEWHERE, {
          callId: call.callId,
        });

        for (const p of peers) {
          const canView = await canViewProfilePhoto(p.userId, userId);
          const targetSocket = call.participants.get(p.userId)?.socketId;
          if (targetSocket) {
            io.to(targetSocket).emit(CALL_SOCKET_EVENTS.GCALL_PEER_JOINED, {
              callId: call.callId,
              ...profile,
              avatar: canView ? profile.avatar : "",
            });
          }
        }

        const safePeers = await Promise.all(
          peers.map(async (p) => {
            const canView = await canViewProfilePhoto(userId, p.userId);
            return {
              ...p,
              avatar: canView ? p.avatar : "",
            };
          }),
        );

        return reply({
          ok: true,
          callId: call.callId,
          type: call.type,
          peers: safePeers,
        });
      }

      const peers = [...call.participants.entries()]
        .filter(([uid]) => uid !== userId)
        .map(([uid, p]) => ({
          userId: uid,
          fullName: p.fullName,
          avatar: p.avatar,
        }));

      reply({
        ok: true,
        callId: call.callId,
        type: call.type,
        peers,
      });
    } catch (err) {
      console.error("[gcall] join failed:", err?.message || err);
      reply({ ok: false, reason: "error" });
    }
  });

  socket.on(CALL_SOCKET_EVENTS.GCALL_STATUS, ({ groupId } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => {};
    const call = calls.get(String(groupId || ""));
    if (!call || !call.memberIds.includes(userId)) {
      return reply({ active: false });
    }
    reply({
      active: true,
      callId: call.callId,
      type: call.type,
      count: call.participants.size,
      joined: call.participants.has(userId),
    });
  });

  socket.on(CALL_SOCKET_EVENTS.GCALL_SIGNAL, ({ callId, to, data } = {}) => {
    const call = myCall(callId);
    if (!call || !data || !to || String(to) === userId) return;

    if (
      !socketLimiter.consume(
        userId,
        CALL_SOCKET_EVENTS.GCALL_SIGNAL,
        SOCKET_RATE_LIMITS.GCALL_SIGNAL,
      )
    ) {
      return;
    }

    const target = call.participants.get(String(to));
    if (!target) return;

    let validatedData = null;
    if (data.description) {
      const sdp = validateSdp(data.description);
      if (sdp) validatedData = { description: sdp };
    } else if (data.candidate) {
      const cand = validateIceCandidate(data.candidate);
      if (cand) validatedData = { candidate: cand };
    }

    if (!validatedData) return;

    io.to(target.socketId).emit(CALL_SOCKET_EVENTS.GCALL_SIGNAL, {
      callId,
      from: userId,
      data: validatedData,
    });
  });

  socket.on(CALL_SOCKET_EVENTS.GCALL_MEDIA, ({ callId, audio, video } = {}) => {
    const call = myCall(callId);
    if (!call) return;

    if (
      !socketLimiter.consume(
        userId,
        CALL_SOCKET_EVENTS.GCALL_MEDIA,
        SOCKET_RATE_LIMITS.GCALL_MEDIA,
      )
    ) {
      return;
    }

    const media = validateMediaPayload({ audio, video });
    for (const [uid, p] of call.participants) {
      if (uid !== userId) {
        io.to(p.socketId).emit(CALL_SOCKET_EVENTS.GCALL_MEDIA, {
          callId,
          userId,
          audio: media.audio,
          video: media.video,
        });
      }
    }
  });

  socket.on(CALL_SOCKET_EVENTS.GCALL_LEAVE, ({ callId } = {}) => {
    const call = myCall(callId);
    if (call) removeParticipant(io, call, userId, "left");
  });

  socket.on("disconnect", () => {
    socketLimiter.reset(userId);
    const gid = userGroup.get(userId);
    const call = gid && calls.get(gid);
    if (call && call.participants.get(userId)?.socketId === socket.id) {
      removeParticipant(io, call, userId, "disconnected");
    }
  });
}
