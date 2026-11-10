import User from "../../models/users.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

/**
 * Finds user public key with password for verification.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<import("mongoose").Document|null>}
 */
export const findUserWithPublicKey = async (userId) => {
  return User.findById(toObjectId(userId)).select("+publicKey +password");
};

/**
 * Updates a user's public key.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {object} publicKey
 * @returns {Promise<object|null>}
 */
export const updateUserPublicKey = async (userId, publicKey) => {
  return User.findByIdAndUpdate(
    toObjectId(userId),
    { $set: { publicKey, publicKeyUpdatedAt: new Date() } },
    { new: true },
  )
    .select("+publicKey")
    .lean();
};

/**
 * Finds user public key by target ID.
 * @param {string|import("mongoose").Types.ObjectId} targetId
 * @returns {Promise<object|null>}
 */
export const findPublicKeyByUserId = async (targetId) => {
  return User.findById(toObjectId(targetId))
    .select("+publicKey publicKeyUpdatedAt")
    .lean();
};

const userKeyRepository = {
  findUserWithPublicKey,
  updateUserPublicKey,
  findPublicKeyByUserId,
};

export default userKeyRepository;
