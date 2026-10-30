import Session from "../models/session.model.js";
import User from "../models/users.model.js";
import { parseDevice, getIp, sanitizeIp } from "../utils/device-info.js";
import { sendLoginAlertEmail } from "../utils/email-service.js";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import { io } from "../lib/socket.js";
import { formatDistanceToNow } from "../utils/time-utils.js";

export const createLoginSession = async (req, user) => {
  const deviceInfo = parseDevice(req.headers["user-agent"]);
  const rawIp = getIp(req);

  const session = await Session.create({
    userId: user._id,
    device: deviceInfo,
    ip: sanitizeIp(rawIp),
    location: "Location unavailable",
  });

  const { accessToken, refreshToken } = await User.generateToken(
    user._id,
    session._id,
  );

  if (user.loginAlerts) {
    const time = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });
    sendLoginAlertEmail(user.email, {
      deviceLabel: deviceInfo.label,
      location: "Location unavailable",
      time,
    }).catch(() => {});
  }

  return { accessToken, refreshToken, deviceInfo };
};

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

export const listUserSessions = async ({ userId, currentSessionId }) => {
  const sessions = await Session.find(getActiveSessionsQuery(userId, null))
    .sort({ lastActivity: -1 })
    .select("_id device ip location lastActivity createdAt")
    .lean();

  return sessions.map((session) => formatSession(session, currentSessionId));
};

export const revokeUserSession = async ({ userId, sessionId }) => {
  const session = await getOwnedSession(userId, sessionId);

  if (!session) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Session not found.");
  }
  if (session.revoked) {
    throw new ApiError(StatusCodes.CONFLICT, "Session is already revoked.");
  }

  session.revoked = true;
  await session.save();

  emitSessionEvent(userId, "session:revoked", {
    sessionId: String(session._id),
  });
};

export const revokeOtherUserSessions = async ({ userId, currentSessionId }) => {
  const filter = getActiveSessionsQuery(userId, currentSessionId);

  const { modifiedCount } = await Session.updateMany(filter, {
    $set: { revoked: true },
  });

  await User.findByIdAndUpdate(userId, { $inc: { tokenVersion: 1 } });

  emitSessionEvent(userId, "session:revoke-others", {
    keepSessionId: currentSessionId || null,
  });

  return { revokedCount: modifiedCount };
};
