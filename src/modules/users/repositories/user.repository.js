import User from "../models/users.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const create = async (userData, options = {}) => {
  if (options.session) {
    const [user] = await User.create([userData], { session: options.session });
    return user;
  }

  return User.create(userData);
};

export const createUser = (userData, options) => create(userData, options);

export const find = (filter = {}, projection, options = {}) => {
  const query = User.find(filter);

  if (projection) query.select(projection);
  if (options.session) query.session(options.session);

  return query;
};

export const findOne = (filter = {}, projection, options = {}) => {
  const query = User.findOne(filter);

  if (projection) query.select(projection);
  if (options.session) query.session(options.session);

  return query;
};

export const exists = async (filter, options = {}) => {
  const query = User.exists(filter);

  if (options.session) query.session(options.session);

  const result = await query;

  return Boolean(result);
};

export const existsById = async (id, options = {}) => {
  const query = User.exists({ _id: toObjectId(id) });

  if (options.session) query.session(options.session);

  const result = await query;

  return Boolean(result);
};

export const findByEmail = (email, options = {}) => {
  const query = User.findOne({ email: String(email).toLowerCase() });

  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);

  return query;
};

export const findByEmailWithLoginSecrets = (email, options = {}) => {
  const query = User.findOne({
    email: String(email).toLowerCase(),
  }).select("+password +twoFactorSecret +twoFactorEnabled +loginAlerts");

  if (options.session) query.session(options.session);

  return query;
};

export const findById = (id, options = {}) => {
  const query = User.findById(toObjectId(id));

  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);

  return query;
};

export const findByIdSelect = (id, select, options = {}) => {
  const query = User.findById(toObjectId(id)).select(select);

  if (options.session) query.session(options.session);

  return query;
};

export const findByIdLeanSelect = (id, select, options = {}) => {
  const query = User.findById(toObjectId(id)).select(select);

  if (options.session) query.session(options.session);

  return query.lean();
};

export const findByIdAndUpdate = (id, update, options = {}) =>
  User.findByIdAndUpdate(toObjectId(id), update, options);

export const findByIdAndUpdateSelect = (id, update, options, select) =>
  User.findByIdAndUpdate(toObjectId(id), update, options).select(select);

export const updateById = async (id, update, options = { new: true }) => {
  const query = User.findByIdAndUpdate(toObjectId(id), update, {
    new: true,
    runValidators: true,
    ...options,
  });

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updateOne = (filter, update, options = {}) =>
  User.updateOne(filter, update, options);

export const updateMany = (filter, update, options = {}) =>
  User.updateMany(filter, update, options);

export const findByIdAndDelete = (id, options = {}) =>
  User.findByIdAndDelete(toObjectId(id), options);

export const deleteById = (id, options) => findByIdAndDelete(id, options);

export const existsUsernameExcept = async (username, userId, options = {}) => {
  const query = User.exists({
    username: String(username).toLowerCase(),
    _id: { $ne: toObjectId(userId) },
  });

  if (options.session) query.session(options.session);

  const found = await query;

  return Boolean(found);
};

export const existsBlockedEitherWay = async (a, b, options = {}) => {
  const query = User.exists({
    $or: [
      { _id: toObjectId(a), blockedUsers: toObjectId(b) },
      { _id: toObjectId(b), blockedUsers: toObjectId(a) },
    ],
  });

  if (options.session) query.session(options.session);

  const found = await query;

  return Boolean(found);
};

export const existsViewerBlockedTarget = async (
  viewerId,
  targetUserId,
  options = {},
) => {
  const query = User.exists({
    _id: toObjectId(viewerId),
    blockedUsers: toObjectId(targetUserId),
  });

  if (options.session) query.session(options.session);

  const found = await query;

  return Boolean(found);
};

export const findByResetToken = (hashedToken, options = {}) => {
  const query = User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpires +tokenVersion");

  if (options.session) query.session(options.session);

  return query;
};

export const findByIds = (ids, select, options = {}) => {
  const query = User.find({
    _id: { $in: ids.map(toObjectId) },
  });

  if (select) query.select(select);
  if (options.session) query.session(options.session);

  return query;
};

export const findByIdsLean = (ids, select, options = {}) =>
  findByIds(ids, select, options).lean();

export const findBlockersOf = (userIds, targetId, options = {}) => {
  const query = User.find({
    _id: { $in: userIds.map(toObjectId) },
    blockedUsers: toObjectId(targetId),
  }).select("_id");

  if (options.session) query.session(options.session);

  return query.lean();
};

export const pullRelationFromAll = (userId, options = {}) => {
  const uid = toObjectId(userId);

  return User.updateMany(
    {
      $or: [{ blockedUsers: uid }, { favorites: uid }],
    },
    {
      $pull: {
        blockedUsers: uid,
        favorites: uid,
      },
    },
    options,
  );
};

export const findUsersMatching = (filter, select, options = {}) => {
  const query = User.find(filter);

  if (select) query.select(select);
  if (options.session) query.session(options.session);

  return query;
};

export const generateUserTokens = (userId, sessionId) =>
  User.generateToken(userId, sessionId);

export const startSession = () => User.startSession();

export const findByUsername = async (username, options = {}) => {
  if (!username) return null;
  const query = User.findOne({ username: String(username).toLowerCase() });
  if (options.session) query.session(options.session);
  return query.lean();
};

const userRepository = Object.freeze({
  create,
  createUser,
  find,
  findOne,
  exists,
  existsById,
  findByEmail,
  findByEmailWithLoginSecrets,
  findById,
  findByIdSelect,
  findByIdLeanSelect,
  findByIdAndUpdate,
  findByIdAndUpdateSelect,
  findByIdAndDelete,
  updateById,
  updateOne,
  updateMany,
  deleteById,
  existsUsernameExcept,
  existsBlockedEitherWay,
  existsViewerBlockedTarget,
  findByResetToken,
  findByIds,
  findByIdsLean,
  findBlockersOf,
  pullRelationFromAll,
  findUsersMatching,
  generateUserTokens,
  startSession,
  findByUsername,
  findByIdAndUpdate,
  findByEmailWithLoginSecrets,
});

export default userRepository;
