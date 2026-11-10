import User from "../models/users.model.js";
import Session from "../models/session.model.js";
import { toObjectId } from "../utils/object-id.util.js";

/**
 * Finds a single user by ID.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {string|object} [projection]
 * @returns {Promise<object|null>}
 */
export const findUserById = async (userId, projection) => {
  const query = User.findById(toObjectId(userId));
  if (projection) query.select(projection);
  return query.lean();
};

/**
 * Finds a single user document (un-leaned) by ID for operations requiring instance methods.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {string|object} [projection]
 * @returns {Promise<import("mongoose").Document|null>}
 */
export const findUserDocumentById = async (userId, projection) => {
  const query = User.findById(toObjectId(userId));
  if (projection) query.select(projection);
  return query;
};

/**
 * Finds a user by email address (case-insensitive).
 * @param {string} email
 * @param {string|object} [projection]
 * @returns {Promise<object|null>}
 */
export const findUserByEmail = async (email, projection) => {
  const query = User.findOne({ email: String(email).toLowerCase() });
  if (projection) query.select(projection);
  return query.lean();
};

/**
 * Finds a user document by email (for password verification or mutations).
 * @param {string} email
 * @param {string|object} [projection]
 * @returns {Promise<import("mongoose").Document|null>}
 */
export const findUserDocumentByEmail = async (email, projection) => {
  const query = User.findOne({ email: String(email).toLowerCase() });
  if (projection) query.select(projection);
  return query;
};

/**
 * Finds a user by username.
 * @param {string} username
 * @param {string|object} [projection]
 * @returns {Promise<object|null>}
 */
export const findUserByUsername = async (username, projection) => {
  const query = User.findOne({ username: String(username).toLowerCase() });
  if (projection) query.select(projection);
  return query.lean();
};

/**
 * Finds multiple users by a list of IDs.
 * @param {string[]|import("mongoose").Types.ObjectId[]} userIds
 * @param {string|object} [projection]
 * @returns {Promise<object[]>}
 */
export const findUsersByIds = async (userIds, projection) => {
  const query = User.find({ _id: { $in: userIds.map(toObjectId) } });
  if (projection) query.select(projection);
  return query.lean();
};

/**
 * Checks if a user matching the filter exists.
 * @param {object} filter
 * @returns {Promise<boolean>}
 */
export const existsUser = async (filter) => {
  const result = await User.exists(filter);
  return Boolean(result);
};

/**
 * Creates and persists a new user document.
 * @param {object} userData
 * @returns {Promise<import("mongoose").Document>}
 */
export const createUser = async (userData) => {
  return User.create(userData);
};

/**
 * Updates a user document by ID.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {object} update
 * @param {object} [options={ new: true }]
 * @returns {Promise<object|null>}
 */
export const updateUserById = async (userId, update, options = { new: true }) => {
  return User.findByIdAndUpdate(toObjectId(userId), update, options).lean();
};

/**
 * Deletes a user by ID.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<object|null>}
 */
export const deleteUserById = async (userId) => {
  return User.findByIdAndDelete(toObjectId(userId)).lean();
};

// --- Session Repository Methods ---

/**
 * Creates and persists a new session.
 * @param {object} sessionData
 * @returns {Promise<import("mongoose").Document>}
 */
export const createSession = async (sessionData) => {
  return Session.create(sessionData);
};

/**
 * Finds an active (non-revoked, unexpired) session by ID.
 * @param {string|import("mongoose").Types.ObjectId} sessionId
 * @returns {Promise<object|null>}
 */
export const findActiveSessionById = async (sessionId) => {
  return Session.findOne({
    _id: toObjectId(sessionId),
    revoked: false,
    expiresAt: { $gt: new Date() },
  }).lean();
};

/**
 * Finds all active sessions for a given user.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<object[]>}
 */
export const findActiveSessionsByUserId = async (userId) => {
  return Session.find({
    userId: toObjectId(userId),
    revoked: false,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActivity: -1 })
    .lean();
};

/**
 * Updates last activity timestamp for a session.
 * @param {string|import("mongoose").Types.ObjectId} sessionId
 * @returns {Promise<object|null>}
 */
export const touchSession = async (sessionId) => {
  return Session.findByIdAndUpdate(
    toObjectId(sessionId),
    { $set: { lastActivity: new Date() } },
    { new: true },
  ).lean();
};

/**
 * Revokes a single session by ID for a user.
 * @param {string|import("mongoose").Types.ObjectId} sessionId
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<object|null>}
 */
export const revokeSession = async (sessionId, userId) => {
  return Session.findOneAndUpdate(
    { _id: toObjectId(sessionId), userId: toObjectId(userId) },
    { $set: { revoked: true } },
    { new: true },
  ).lean();
};

/**
 * Revokes all sessions for a user except the specified current session.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {string|import("mongoose").Types.ObjectId} currentSessionId
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const revokeOtherSessions = async (userId, currentSessionId) => {
  return Session.updateMany(
    {
      userId: toObjectId(userId),
      _id: { $ne: toObjectId(currentSessionId) },
      revoked: false,
    },
    { $set: { revoked: true } },
  );
};

/**
 * Revokes all sessions for a user.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const revokeAllSessions = async (userId) => {
  return Session.updateMany(
    { userId: toObjectId(userId), revoked: false },
    { $set: { revoked: true } },
  );
};

const userRepository = {
  findUserById,
  findUserDocumentById,
  findUserByEmail,
  findUserDocumentByEmail,
  findUserByUsername,
  findUsersByIds,
  existsUser,
  createUser,
  updateUserById,
  deleteUserById,
  createSession,
  findActiveSessionById,
  findActiveSessionsByUserId,
  touchSession,
  revokeSession,
  revokeOtherSessions,
  revokeAllSessions,
};

export default userRepository;
