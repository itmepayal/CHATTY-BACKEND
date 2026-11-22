import crypto from "crypto";
import * as callRepository from "../repositories/call.repository.js";
import * as userRepository from "../../users/repositories/user.repository.js";
import * as contactRepository from "../../contacts/repositories/contact.repository.js";
import { canViewSync } from "../../privacy/services/privacy-visibility.service.js";
import { CALL_LIMITS, CALL_SOCKET_EVENTS } from "../constants/call.constants.js";
import { io } from "../../../infrastructure/socket/socket.js";

export const formatCallRecord = (
  c,
  userId,
  targetSavedViewerSet = new Set(),
  blockedSet = new Set(),
) => {
  const callerIdStr = c.callerId?._id
    ? String(c.callerId._id)
    : c.callerId
      ? String(c.callerId)
      : null;
  const isOutgoing = callerIdStr === String(userId);
  const other = isOutgoing ? c.receiverId : c.callerId;
  const otherIdStr = other?._id
    ? String(other._id)
    : other
      ? String(other)
      : null;

  let otherUserPayload = {
    id: otherIdStr,
    fullName: other?.fullName || "User",
    avatar: "",
  };

  if (other && other._id) {
    const isBlocked = blockedSet.has(otherIdStr);
    const inContacts = targetSavedViewerSet.has(otherIdStr);
    const canSeePhoto =
      !isBlocked &&
      canViewSync(
        other.profilePhotoVisibility ?? "everyone",
        otherIdStr,
        userId,
        inContacts,
        other.profilePhotoExceptions || [],
      );
    otherUserPayload = {
      id: other._id,
      fullName: other.fullName || "User",
      avatar: canSeePhoto ? other.avatar?.url || "" : "",
    };
  }

  const isSeen = isOutgoing
    ? true
    : Boolean(
        c.seen === true ||
          (Array.isArray(c.readBy) &&
            c.readBy.some((id) => String(id) === String(userId))),
      );

  return {
    id: c._id,
    callId: c.callId,
    direction: isOutgoing ? "outgoing" : "incoming",
    type: c.type,
    status: c.status,
    duration: Math.max(0, c.duration || 0),
    activeDuration: Math.max(0, c.activeDuration ?? c.duration ?? 0),
    holdDuration: Math.max(0, c.holdDuration || 0),
    holdCycles: c.holdCycles || 0,
    holdOwnerId: c.holdOwnerId || null,
    holdStartedAt: c.holdStartedAt || null,
    holdStateVersion: c.holdStateVersion || 0,
    startedAt: c.startedAt,
    answeredAt: c.answeredAt || null,
    endedAt: c.endedAt || null,
    seen: isSeen,
    seenAt: c.seenAt || null,
    user: otherUserPayload,
  };
};

export const getCallHistoryList = async ({
  userId,
  limit = 50,
  page = 1,
  status = null,
  direction = null,
  type = null,
}) => {
  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || CALL_LIMITS.DEFAULT_PAGE_LIMIT, CALL_LIMITS.MAX_PAGE_LIMIT),
  );
  const safePage = Math.max(1, Number(page) || 1);
  const skip = (safePage - 1) * safeLimit;

  const calls = await callRepository.findHistoryForUser(userId, {
    skip,
    limit: safeLimit,
    status,
    direction,
    type,
  });

  const otherUserIds = [];
  for (const c of calls) {
    const cId = c.callerId?._id
      ? String(c.callerId._id)
      : c.callerId
        ? String(c.callerId)
        : null;
    const rId = c.receiverId?._id
      ? String(c.receiverId._id)
      : c.receiverId
        ? String(c.receiverId)
        : null;
    const isCallerMe = cId === String(userId);
    const otherId = isCallerMe ? rId : cId;
    if (otherId && otherId !== String(userId)) otherUserIds.push(otherId);
  }

  const [savedContacts, blockers, meDoc] = await Promise.all([
    contactRepository
      .find({ ownerId: { $in: otherUserIds }, contactId: userId })
      .select("ownerId")
      .lean(),
    userRepository.findBlockersOf(otherUserIds, userId),
    userRepository.findByIdLeanSelect(userId, "blockedUsers"),
  ]);

  const targetSavedViewerSet = new Set(
    savedContacts.map((c) => String(c.ownerId)),
  );
  const blockedSet = new Set([
    ...blockers.map((b) => String(b._id)),
    ...(meDoc?.blockedUsers || []).map(String),
  ]);

  return calls.map((c) =>
    formatCallRecord(c, userId, targetSavedViewerSet, blockedSet),
  );
};

export const createCallRecord = async ({
  callId,
  callerId,
  receiverId,
  type,
  status,
  startedAt,
  answeredAt,
  endedAt,
  duration = 0,
  activeDuration = 0,
  holdDuration = 0,
  holdCycles = 0,
  holdOwnerId = null,
  holdStartedAt = null,
  holdStateVersion = 0,
  endedBy,
  endReason,
}) => {
  const finalCallId = callId || crypto.randomUUID();
  try {
    return await callRepository.upsertByCallId(finalCallId, {
      callId: finalCallId,
      callerId,
      receiverId,
      type,
      status,
      startedAt: startedAt || new Date(),
      answeredAt: answeredAt || undefined,
      endedAt: endedAt || new Date(),
      duration: Math.max(0, Math.round(duration)),
      activeDuration: Math.max(0, Math.round(activeDuration)),
      holdDuration: Math.max(0, Math.round(holdDuration)),
      holdCycles: Math.max(0, Math.round(holdCycles)),
      holdOwnerId: holdOwnerId || undefined,
      holdStartedAt: holdStartedAt || undefined,
      holdStateVersion: Math.max(0, Number(holdStateVersion) || 0),
      endedBy: endedBy || undefined,
      endReason: typeof endReason === "string" ? endReason : undefined,
    });
  } catch (err) {
    if (err.code === 11000) {
      return callRepository.findByCallId(finalCallId);
    }
    throw err;
  }
};

export const markMissedCallsAsSeen = async ({
  userId,
  callerId = null,
  callIds = null,
}) => {
  const result = await callRepository.markCallsAsReadForUser(userId, {
    callerId,
    callIds,
  });

  const remainingUnread = await callRepository.countUnreadMissedCalls(userId);

  // Emit socket event to all active sessions of this user so other devices/tabs stay in sync
  try {
    io.to(String(userId)).emit(CALL_SOCKET_EVENTS.CALL_MISSED_CLEARED, {
      callerId: callerId ? String(callerId) : null,
      remainingUnseen: remainingUnread,
    });
  } catch (err) {
    console.error("[call] failed to emit CALL_MISSED_CLEARED:", err?.message || err);
  }

  return {
    modifiedCount: result.modifiedCount || 0,
    remainingUnseen: remainingUnread,
  };
};

export const deleteCallHistoryItem = async (userId, callId) => {
  const result = await callRepository.deleteCallForUser(callId, userId);
  return { success: Boolean(result), callId };
};

export const bulkDeleteCallHistory = async (userId, callIds) => {
  if (!Array.isArray(callIds) || callIds.length === 0) {
    return { success: true, count: 0, deletedIds: [] };
  }
  const result = await callRepository.deleteCallsForUser(callIds, userId);
  return {
    success: true,
    count: result.modifiedCount || 0,
    deletedIds: callIds,
  };
};

export const clearUserCallHistory = async (userId) => {
  const result = await callRepository.clearHistoryForUser(userId);
  return { success: true, count: result.modifiedCount || 0 };
};

/**
 * Returns dynamic, secure STUN & TURN server configurations for WebRTC peer connections.
 * In production, generates time-limited HMAC credentials if TURN_SECRET is configured.
 */
export const getIceServersConfig = (userId = null) => {
  const servers = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    { urls: ["stun:stun.cloudflare.com:3478"] },
  ];

  const turnUrl = process.env.TURN_URL || process.env.VITE_TURN_URL;
  const turnSecret = process.env.TURN_SECRET;
  const turnUser = process.env.TURN_USER || process.env.VITE_TURN_USER;
  const turnPass = process.env.TURN_PASS || process.env.VITE_TURN_PASS;

  let turnOperational = false;
  let turnWarning = null;

  if (turnUrl) {
    if (turnSecret) {
      // Ephemeral coturn HMAC credentials (valid for 24 hours)
      const expiry = Math.floor(Date.now() / 1000) + 24 * 3600;
      const username = `${expiry}:${userId || "chatty"}`;
      const hmac = crypto.createHmac("sha1", turnSecret);
      hmac.update(username);
      const credential = hmac.digest("base64");

      const urls = turnUrl.split(",").map((u) => u.trim());
      servers.push({
        urls,
        username,
        credential,
      });
      turnOperational = true;
    } else if (turnUser && turnPass) {
      const urls = turnUrl.split(",").map((u) => u.trim());
      servers.push({
        urls,
        username: turnUser,
        credential: turnPass,
      });
      turnOperational = true;
    } else {
      turnWarning =
        "TURN_URL is configured, but TURN_SECRET is missing. Relay support is disabled for security.";
      console.warn(`[call:security] ${turnWarning}`);
    }
  }

  return {
    iceServers: servers,
    turnOperational,
    warning: turnWarning,
  };
};

const callService = {
  formatCallRecord,
  getCallHistoryList,
  createCallRecord,
  markMissedCallsAsSeen,
  deleteCallHistoryItem,
  bulkDeleteCallHistory,
  clearUserCallHistory,
  getIceServersConfig,
};

export default callService;

