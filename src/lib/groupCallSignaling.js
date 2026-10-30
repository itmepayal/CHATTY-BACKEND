import crypto from "crypto";
import mongoose from "mongoose";
import Group from "../models/group.model.js";
import User from "../models/users.model.js";
import GroupCall from "../models/group-call.model.js";
import { isUserInCall } from "./callSignaling.js";
import {
  MAX_CALL_PARTICIPANTS,
  GROUP_CALL_RING_TIMEOUT_MS,
} from "../constants/constants.js";

const MAX_PARTICIPANTS = MAX_CALL_PARTICIPANTS;
const RING_TIMEOUT_MS = GROUP_CALL_RING_TIMEOUT_MS;

const calls = new Map();
const userGroup = new Map();

export const isUserInGroupCall = (userId) => userGroup.has(String(userId));

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
  if (calls.get(call.groupId) !== call) return;

  clearTimeout(call.timer);
  calls.delete(call.groupId);
  for (const uid of call.participants.keys()) userGroup.delete(uid);

  const endedAt = new Date();
  const duration = call.connectedAt
    ? Math.max(0, Math.round((endedAt - call.connectedAt) / 1000))
    : 0;
  const finalStatus = call.everMulti ? "completed" : status;

  const payload = {
    callId: call.callId,
    groupId: call.groupId,
    status: finalStatus,
    reason,
    duration,
  };
  for (const memberId of call.memberIds) {
    io.to(memberId).emit("gcall:ended", payload);
  }

  try {
    await GroupCall.create({
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
  if (!call.participants.has(userId)) return;

  call.participants.delete(userId);
  userGroup.delete(userId);

  for (const p of call.participants.values()) {
    io.to(p.socketId).emit("gcall:peer-left", {
      callId: call.callId,
      userId,
      reason,
    });
  }

  if (call.participants.size === 0) {
    finishCall(io, call, { status: "cancelled", reason: "empty" });
  } else if (call.participants.size === 1 && call.everMulti) {
    finishCall(io, call, { status: "completed", reason: "everyone-left" });
  }
}

export function registerGroupCallHandlers(io, socket) {
  const userId = socket.data.userId;

  const myCall = (callId) => {
    const gid = userGroup.get(userId);
    const call = gid && calls.get(gid);
    if (!call || call.callId !== callId) return null;
    if (call.participants.get(userId)?.socketId !== socket.id) return null;
    return call;
  };

  socket.on("gcall:start", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => { };
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

      const profile = await getProfile(userId, socket.data.fullName);

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
        finishCall(io, call, { status: "missed", reason: "no-answer" });
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
        if (memberId !== userId)
          io.to(memberId).emit("gcall:incoming", incoming);
      }

      reply({ ok: true, callId, me: profile });
    } catch (err) {
      console.error("[gcall] start failed:", err?.message || err);
      reply({ ok: false, reason: "error" });
    }
  });

  socket.on("gcall:join", async (payload, ack) => {
    const reply = typeof ack === "function" ? ack : () => { };
    try {
      const gid = String(payload?.groupId || "");
      const call = calls.get(gid);
      if (!call) return reply({ ok: false, reason: "no-call" });
      if (!call.memberIds.includes(userId)) {
        return reply({ ok: false, reason: "not-member" });
      }
      if (call.participants.has(userId)) {
        return reply({ ok: false, reason: "already-joined" });
      }
      if (isUserInCall(userId) || isUserInGroupCall(userId)) {
        return reply({ ok: false, reason: "busy" });
      }
      if (call.participants.size >= MAX_PARTICIPANTS) {
        return reply({ ok: false, reason: "full" });
      }

      const profile = await getProfile(userId, socket.data.fullName);

      if (
        calls.get(gid) !== call ||
        call.participants.has(userId) ||
        call.participants.size >= MAX_PARTICIPANTS
      ) {
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
        clearTimeout(call.timer);
      }

      socket.to(userId).emit("gcall:joined-elsewhere", {
        callId: call.callId,
      });

      for (const p of peers) {
        io.to(call.participants.get(p.userId).socketId).emit(
          "gcall:peer-joined",
          { callId: call.callId, ...profile },
        );
      }

      reply({ ok: true, callId: call.callId, type: call.type, peers });
    } catch (err) {
      console.error("[gcall] join failed:", err?.message || err);
      reply({ ok: false, reason: "error" });
    }
  });

  socket.on("gcall:status", ({ groupId } = {}, ack) => {
    const reply = typeof ack === "function" ? ack : () => { };
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

  socket.on("gcall:signal", ({ callId, to, data } = {}) => {
    const call = myCall(callId);
    if (!call || !data) return;
    const target = call.participants.get(String(to));
    if (!target) return;
    io.to(target.socketId).emit("gcall:signal", {
      callId,
      from: userId,
      data,
    });
  });

  socket.on("gcall:media", ({ callId, audio, video } = {}) => {
    const call = myCall(callId);
    if (!call) return;
    for (const [uid, p] of call.participants) {
      if (uid !== userId) {
        io.to(p.socketId).emit("gcall:media", {
          callId,
          userId,
          audio: Boolean(audio),
          video: Boolean(video),
        });
      }
    }
  });

  socket.on("gcall:leave", ({ callId } = {}) => {
    const call = myCall(callId);
    if (call) removeParticipant(io, call, userId, "left");
  });

  socket.on("disconnect", () => {
    const gid = userGroup.get(userId);
    const call = gid && calls.get(gid);
    if (call && call.participants.get(userId)?.socketId === socket.id) {
      removeParticipant(io, call, userId, "disconnected");
    }
  });
}
