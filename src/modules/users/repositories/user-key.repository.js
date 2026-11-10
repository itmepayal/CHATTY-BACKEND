import User from "../models/users.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const findUserWithPublicKey = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select(
    "+publicKey +password",
  );

  if (options.session) query.session(options.session);

  return options.lean ? query.lean() : query;
};

export const updateUserPublicKey = async (userId, publicKey, options = {}) => {
  const query = User.findByIdAndUpdate(
    toObjectId(userId),
    {
      $set: {
        publicKey,
        publicKeyUpdatedAt: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
      ...options,
    },
  ).select("+publicKey");

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updateByUserId = (userId, publicKey, options) =>
  updateUserPublicKey(userId, publicKey, options);

export const findPublicKeyByUserId = async (targetId, options = {}) => {
  const query = User.findById(toObjectId(targetId)).select(
    "+publicKey publicKeyUpdatedAt",
  );

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const findByUserId = (targetId, options) =>
  findPublicKeyByUserId(targetId, options);

export const existsByUserId = async (userId, options = {}) => {
  const query = User.exists({
    _id: toObjectId(userId),
    publicKey: { $ne: null },
  });

  if (options.session) query.session(options.session);

  const found = await query;

  return Boolean(found);
};

const userKeyRepository = Object.freeze({
  findUserWithPublicKey,
  updateUserPublicKey,
  updateByUserId,
  findPublicKeyByUserId,
  findByUserId,
  existsByUserId,
});

export default userKeyRepository;
