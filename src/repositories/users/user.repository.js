import User from "../../models/users.model.js";

export const find = (filter) => User.find(filter);

export const exists = (filter) => User.exists(filter);

export const findByEmail = (email) => User.findOne({ email });

export const findByEmailWithLoginSecrets = (email) =>
  User.findOne({ email }).select(
    "+password +twoFactorSecret +twoFactorEnabled +loginAlerts",
  );

export const createUser = (userData) => User.create(userData);

export const findById = (id) => User.findById(id);

export const findByIdSelect = (id, select) => User.findById(id).select(select);

export const findByIdLeanSelect = (id, select) =>
  User.findById(id).select(select).lean();

export const findByIdAndUpdate = (id, update, options) =>
  User.findByIdAndUpdate(id, update, options);

export const findByIdAndUpdateSelect = (id, update, options, select) =>
  User.findByIdAndUpdate(id, update, options).select(select);

export const findByIdAndDelete = (id, options) =>
  User.findByIdAndDelete(id, options);

export const existsById = (id) => User.exists({ _id: id });

export const existsUsernameExcept = (username, userId) =>
  User.exists({ username, _id: { $ne: userId } });

export const existsBlockedEitherWay = (a, b) =>
  User.exists({
    $or: [
      { _id: a, blockedUsers: b },
      { _id: b, blockedUsers: a },
    ],
  });

export const existsViewerBlockedTarget = (viewerId, targetUserId) =>
  User.exists({ _id: viewerId, blockedUsers: targetUserId });

export const findByResetToken = (hashedToken) =>
  User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpires +tokenVersion");

export const findByIds = (ids, select) => {
  const query = User.find({ _id: { $in: ids } });
  if (select) query.select(select);
  return query;
};

export const findByIdsLean = (ids, select) => findByIds(ids, select).lean();

export const findBlockersOf = (userIds, targetId) =>
  User.find({ _id: { $in: userIds }, blockedUsers: targetId })
    .select("_id")
    .lean();

export const pullRelationFromAll = (userId, options) =>
  User.updateMany(
    { $or: [{ blockedUsers: userId }, { favorites: userId }] },
    { $pull: { blockedUsers: userId, favorites: userId } },
    options,
  );

export const findUsersMatching = (filter, select) => {
  const query = User.find(filter);
  if (select) query.select(select);
  return query;
};

export const generateUserTokens = (userId, sessionId) =>
  User.generateToken(userId, sessionId);

export const startSession = () => User.startSession();

