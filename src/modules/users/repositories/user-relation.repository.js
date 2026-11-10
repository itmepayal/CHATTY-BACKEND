import User from "../models/users.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const existsBlockedEitherWay = async (userA, userB, options = {}) => {
  const a = toObjectId(userA);
  const b = toObjectId(userB);
  const query = User.exists({
    $or: [
      { _id: a, blockedUsers: b },
      { _id: b, blockedUsers: a },
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

export const findBlockersOf = async (userIds, targetId, options = {}) => {
  const query = User.find({
    _id: { $in: userIds.map(toObjectId) },
    blockedUsers: toObjectId(targetId),
  }).select("_id");
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findBlockedUsers = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select("blockedUsers");
  if (options.session) query.session(options.session);
  const doc = await query.lean();
  return (doc?.blockedUsers || []).map(String);
};

export const findFavorites = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select("favorites");
  if (options.session) query.session(options.session);
  const doc = await query.lean();
  return (doc?.favorites || []).map(String);
};

export const pullRelationFromAll = async (userId, options = {}) => {
  const uid = toObjectId(userId);
  return User.updateMany(
    { $or: [{ blockedUsers: uid }, { favorites: uid }] },
    { $pull: { blockedUsers: uid, favorites: uid } },
    options,
  );
};

export const updateRelation = async (
  userId,
  update,
  options = { new: true },
) => {
  const query = User.findByIdAndUpdate(toObjectId(userId), update, {
    new: true,
    runValidators: true,
    ...options,
  });
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

const userRelationRepository = Object.freeze({
  existsBlockedEitherWay,
  existsViewerBlockedTarget,
  findBlockersOf,
  findBlockedUsers,
  findFavorites,
  pullRelationFromAll,
  updateRelation,
});

export default userRelationRepository;
