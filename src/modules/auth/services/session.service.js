import * as userRepository from "../../users/repositories/user.repository.js";
import {
  createSession,
  findOwnedSession,
  findActiveSessionsForUser,
  revokeOtherActiveSessions,
} from "../repositories/session.repository.js";
import { parseDevice, sanitizeIp } from "../../../shared/utils/device-info.js";
import { sendLoginAlertEmail } from "../../../infrastructure/email/email-service.js";
import ApiError from "../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";
import {
  io,
  disconnectUserSession,
  disconnectOtherUserSessions,
} from "../../../infrastructure/socket/socket.js";
import { formatDistanceToNow } from "../../../shared/utils/time-utils.js";

export const createLoginSession = async (user, { userAgent, ip } = {}) => {
  const deviceInfo = parseDevice(userAgent);
  const rawIp = ip;

  const session = await createSession({
    userId: user._id,
    device: deviceInfo,
    ip: sanitizeIp(rawIp),
    location: "Location unavailable",
  });

  const { accessToken, refreshToken } = await userRepository.generateUserTokens(
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

const emitSessionEvent = (userId, event, payload) => {
  io.to(String(userId)).emit(event, payload);
};

export const listUserSessions = async ({ userId, currentSessionId }) => {
  const sessions = await findActiveSessionsForUser(userId);

  return sessions.map((session) => formatSession(session, currentSessionId));
};

export const revokeUserSession = async ({ userId, sessionId }) => {
  const session = await findOwnedSession(userId, sessionId);

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
  await disconnectUserSession(userId, session._id);
};

export const revokeOtherUserSessions = async ({ userId, currentSessionId }) => {
  const { modifiedCount } = await revokeOtherActiveSessions(
    userId,
    currentSessionId,
  );

  emitSessionEvent(userId, "session:revoke-others", {
    keepSessionId: currentSessionId || null,
  });
  await disconnectOtherUserSessions(userId, currentSessionId);

  return { revokedCount: modifiedCount };
};

const sessionService = {
  createLoginSession,
  listUserSessions,
  revokeUserSession,
  revokeOtherUserSessions,
};

export default sessionService;
