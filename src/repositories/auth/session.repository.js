import Session from "../../models/session.model.js";

export const createSession = (sessionData) => Session.create(sessionData);

export const findOwnedSession = (userId, sessionId) =>
  Session.findOne({
    _id: sessionId,
    userId,
  });

export const findActiveSessionsForUser = (userId) =>
  Session.find({
    userId,
    revoked: false,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActivity: -1 })
    .select("_id device ip location lastActivity createdAt")
    .lean();

export const revokeOtherActiveSessions = (userId, currentSessionId) =>
  Session.updateMany(
    {
      userId,
      revoked: false,
      ...(currentSessionId ? { _id: { $ne: currentSessionId } } : {}),
      expiresAt: { $gt: new Date() },
    },
    { $set: { revoked: true } },
  );

export const findById = (sessionId) => Session.findById(sessionId);

export const revokeById = (sessionId) =>
  Session.findByIdAndUpdate(sessionId, { revoked: true });

export const revokeAllForUser = (userId) =>
  Session.updateMany({ userId }, { $set: { revoked: true } });

export const revokeOthersForUser = (userId, currentSessionId) =>
  Session.updateMany(
    {
      userId,
      _id: { $ne: currentSessionId },
    },
    { $set: { revoked: true } },
  );

export const deleteAllForUser = (userId, options) =>
  Session.deleteMany({ userId }, options);
