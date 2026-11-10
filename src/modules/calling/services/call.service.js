import crypto from "crypto";
import * as callRepository from "../repositories/call.repository.js";
import * as userRepository from "../../users/repositories/user.repository.js";
import * as contactRepository from "../../contacts/repositories/contact.repository.js";
import { canViewSync } from "../../privacy/services/privacy-visibility.service.js";
import { CALL_LIMITS } from "../constants/call.constants.js";

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
      );
    otherUserPayload = {
      id: other._id,
      fullName: other.fullName || "User",
      avatar: canSeePhoto ? other.avatar?.url || "" : "",
    };
  }

  return {
    id: c._id,
    direction: isOutgoing ? "outgoing" : "incoming",
    type: c.type,
    status: c.status,
    duration: Math.max(0, c.duration || 0),
    startedAt: c.startedAt,
    answeredAt: c.answeredAt || null,
    endedAt: c.endedAt || null,
    user: otherUserPayload,
  };
};

export const getCallHistoryList = async ({ userId, limit = 50, page = 1 }) => {
  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || CALL_LIMITS.DEFAULT_PAGE_LIMIT, CALL_LIMITS.MAX_PAGE_LIMIT),
  );
  const safePage = Math.max(1, Number(page) || 1);
  const skip = (safePage - 1) * safeLimit;

  const calls = await callRepository.findHistoryForUser(userId, {
    skip,
    limit: safeLimit,
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
  endedBy,
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
      endedBy: endedBy || undefined,
    });
  } catch (err) {
    if (err.code === 11000) {
      return callRepository.findByCallId(finalCallId);
    }
    throw err;
  }
};

const callService = {
  formatCallRecord,
  getCallHistoryList,
  createCallRecord,
};

export default callService;

