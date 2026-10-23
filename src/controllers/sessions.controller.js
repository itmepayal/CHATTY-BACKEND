import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import Session from "../models/session.model.js";
import User from "../models/users.model.js";
import { StatusCodes } from "http-status-codes";
import { io } from "../lib/socket.js";
import { formatDistanceToNow } from "../utils/timeUtils.js";

const formatSession = (session, currentSessionId) => ({
  id: session._id,
  device: session.device?.label || "Unknown device",
  browser: session.device?.browser || "Unknown browser",
  os: session.device?.os || "Unknown OS",
  deviceType: session.device?.type || "desktop",
  location: session.location || "Location unavailable",
  lastActivity: session.lastActivity,
  createdAt: session.createdAt,
  lastActiveLabel: formatDistanceToNow(session.lastActivity),
  current: currentSessionId
    ? String(session._id) === String(currentSessionId)
    : false,
});

const getActiveSessionsQuery = (userId, currentSessionId) => ({
  userId,
  revoked: false,
  ...(currentSessionId ? { _id: { $ne: currentSessionId } } : {}),
  expiresAt: { $gt: new Date() },
});

const emitSessionEvent = (userId, event, payload) => {
  io.to(String(userId)).emit(event, payload);
};

const getOwnedSession = async (userId, sessionId) =>
  Session.findOne({
    _id: sessionId,
    userId,
  });

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await Session.find(
    getActiveSessionsQuery(req.user._id, null),
  )
    .sort({ lastActivity: -1 })
    .select("_id device ip location lastActivity createdAt")
    .lean();

  const payload = sessions.map((session) =>
    formatSession(session, req.sessionId),
  );

  return new ApiResponse(
    StatusCodes.OK,
    { sessions: payload },
    "Sessions retrieved.",
  ).send(res);
});

export const revokeSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const session = await getOwnedSession(req.user._id, sessionId);

  if (!session) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Session not found.");
  }
  if (session.revoked) {
    throw new ApiError(StatusCodes.CONFLICT, "Session is already revoked.");
  }

  session.revoked = true;
  await session.save();

  emitSessionEvent(req.user._id, "session:revoked", {
    sessionId: String(session._id),
  });

  return new ApiResponse(
    StatusCodes.OK,
    null,
    "Session revoked successfully.",
  ).send(res);
});

export const revokeOtherSessions = asyncHandler(async (req, res) => {
  const currentSessionId = req.sessionId;
  const filter = getActiveSessionsQuery(req.user._id, currentSessionId);

  const { modifiedCount } = await Session.updateMany(filter, {
    $set: { revoked: true },
  });

  await User.findByIdAndUpdate(req.user._id, { $inc: { tokenVersion: 1 } });

  emitSessionEvent(req.user._id, "session:revoke-others", {
    keepSessionId: currentSessionId || null,
  });

  return new ApiResponse(
    StatusCodes.OK,
    { revokedCount: modifiedCount },
    `Signed out of ${modifiedCount} other session${modifiedCount !== 1 ? "s" : ""}.`,
  ).send(res);
});
