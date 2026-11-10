import Session from "../../models/session.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export const create = async (sessionData, options = {}) => {
  if (options.session) {
    const [doc] = await Session.create([sessionData], {
      session: options.session,
    });
    return doc;
  }
  return Session.create(sessionData);
};

export const createSession = (sessionData, options) =>
  create(sessionData, options);

export const findById = (sessionId, options = {}) => {
  const query = Session.findById(toObjectId(sessionId));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return options.lean ? query.lean() : query;
};

export const findOwnedSession = (userId, sessionId, options = {}) => {
  const query = Session.findOne({
    _id: toObjectId(sessionId),
    userId: toObjectId(userId),
  });
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return options.lean ? query.lean() : query;
};

export const findActiveSessionsForUser = (userId, options = {}) => {
  const query = Session.find({
    userId: toObjectId(userId),
    revoked: false,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActivity: -1 })
    .select(
      options.projection || "_id device ip location lastActivity createdAt",
    );
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findActiveForUser = (userId, options) =>
  findActiveSessionsForUser(userId, options);

export const revokeOtherActiveSessions = (
  userId,
  currentSessionId,
  options = {},
) => {
  const filter = {
    userId: toObjectId(userId),
    revoked: false,
    ...(currentSessionId ? { _id: { $ne: toObjectId(currentSessionId) } } : {}),
    expiresAt: { $gt: new Date() },
  };
  return Session.updateMany(filter, { $set: { revoked: true } }, options);
};

export const revokeOthersForUser = (userId, currentSessionId, options) =>
  Session.updateMany(
    {
      userId: toObjectId(userId),
      _id: { $ne: toObjectId(currentSessionId) },
    },
    { $set: { revoked: true } },
    options,
  );

export const revokeById = (sessionId, options = {}) =>
  Session.findByIdAndUpdate(
    toObjectId(sessionId),
    { revoked: true },
    { new: true, ...options },
  );

export const revokeAllForUser = (userId, options = {}) =>
  Session.updateMany(
    { userId: toObjectId(userId) },
    { $set: { revoked: true } },
    options,
  );

export const touchSession = (sessionId, options = {}) =>
  Session.findByIdAndUpdate(
    toObjectId(sessionId),
    { $set: { lastActivity: new Date() } },
    { new: true, ...options },
  ).lean();

export const deleteAllForUser = (userId, options = {}) =>
  Session.deleteMany({ userId: toObjectId(userId) }, options);

export const deleteOne = (filter, options = {}) =>
  Session.deleteOne(filter, options);

export const deleteMany = (filter, options = {}) =>
  Session.deleteMany(filter, options);

export const exists = async (filter, options = {}) => {
  const query = Session.exists(filter);
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

const sessionRepository = Object.freeze({
  create,
  createSession,
  findById,
  findOwnedSession,
  findActiveSessionsForUser,
  findActiveForUser,
  revokeOtherActiveSessions,
  revokeOthersForUser,
  revokeById,
  revokeAllForUser,
  touchSession,
  deleteAllForUser,
  deleteOne,
  deleteMany,
  exists,
});

export default sessionRepository;
