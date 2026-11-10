import User from "../../models/users.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

const PRIVACY_FIELDS =
  "showOnlineStatus onlineStatusVisibility readReceipts typingIndicator lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission";

/**
 * Finds user privacy settings.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<object|null>}
 */
export const findUserPrivacy = async (userId) => {
  return User.findById(toObjectId(userId)).select(PRIVACY_FIELDS).lean();
};

/**
 * Updates user privacy settings.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {object} update
 * @returns {Promise<object|null>}
 */
export const updateUserPrivacy = async (userId, update) => {
  return User.findByIdAndUpdate(
    toObjectId(userId),
    { $set: update },
    { new: true, runValidators: true },
  )
    .select(PRIVACY_FIELDS)
    .lean();
};

/**
 * Checks bidirectional block status between two users.
 * @param {string|import("mongoose").Types.ObjectId} userA
 * @param {string|import("mongoose").Types.ObjectId} userB
 * @returns {Promise<boolean>}
 */
export const isBlockedBidirectional = async (userA, userB) => {
  const a = toObjectId(userA);
  const b = toObjectId(userB);
  const found = await User.exists({
    $or: [
      { _id: a, blockedUsers: b },
      { _id: b, blockedUsers: a },
    ],
  });
  return Boolean(found);
};

const privacyRepository = {
  findUserPrivacy,
  updateUserPrivacy,
  isBlockedBidirectional,
};

export default privacyRepository;
