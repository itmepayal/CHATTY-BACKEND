import User from "../../models/users.model.js";
import { toObjectId } from "../../utils/object-id.util.js";
import { PRIVACY_PROJECTION_FIELDS as PRIVACY_FIELDS } from "../../constants/privacy/privacy.constants.js";

export const findUserPrivacy = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select(
    options.projection || PRIVACY_FIELDS,
  );

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const findByUserId = (userId, options) =>
  findUserPrivacy(userId, options);

export const updateUserPrivacy = async (
  userId,
  update,
  options = { new: true },
) => {
  const query = User.findByIdAndUpdate(
    toObjectId(userId),
    { $set: update },
    { new: true, runValidators: true, ...options },
  ).select(options.projection || PRIVACY_FIELDS);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updateByUserId = (userId, update, options) =>
  updateUserPrivacy(userId, update, options);

export const isBlockedBidirectional = async (userA, userB, options = {}) => {
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

export const existsBlockedEitherWay = (userA, userB, options) =>
  isBlockedBidirectional(userA, userB, options);

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

export const findBlockedUsers = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select("blockedUsers");

  if (options.session) query.session(options.session);

  const doc = await query.lean();

  return (doc?.blockedUsers || []).map(String);
};

const privacyRepository = Object.freeze({
  findUserPrivacy,
  findByUserId,
  updateUserPrivacy,
  updateByUserId,
  isBlockedBidirectional,
  existsBlockedEitherWay,
  existsViewerBlockedTarget,
  findBlockedUsers,
});

export default privacyRepository;
