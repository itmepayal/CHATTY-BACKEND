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

export const findE2EEStatus = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select(
    "+publicKey +encryptedPrivateKey +e2eeBackupVersion +e2eeBackupUpdatedAt +publicKeyUpdatedAt",
  );

  if (options.session) query.session(options.session);

  return options.lean ? query.lean() : query;
};

export const registerInitialKeysAtomic = async (
  userId,
  { publicKey, encryptedPrivateKey, backupVersion = 1 },
  options = {},
) => {
  const now = new Date();
  const query = User.findOneAndUpdate(
    {
      _id: toObjectId(userId),
      $or: [{ publicKey: null }, { publicKey: { $exists: false } }],
    },
    {
      $set: {
        publicKey,
        encryptedPrivateKey,
        publicKeyUpdatedAt: now,
        e2eeBackupVersion: backupVersion,
        e2eeBackupUpdatedAt: now,
      },
    },
    {
      new: true,
      runValidators: true,
      ...options,
    },
  ).select(
    "+publicKey +encryptedPrivateKey +e2eeBackupVersion +e2eeBackupUpdatedAt +publicKeyUpdatedAt",
  );

  if (options.session) query.session(options.session);

  return options.lean ? query.lean() : query;
};

export const findEncryptedBackup = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select(
    "+publicKey +encryptedPrivateKey +e2eeBackupVersion +e2eeBackupUpdatedAt",
  );

  if (options.session) query.session(options.session);

  return options.lean ? query.lean() : query;
};

export const updateEncryptedBackup = async (
  userId,
  { encryptedPrivateKey, backupVersion },
  options = {},
) => {
  const query = User.findByIdAndUpdate(
    toObjectId(userId),
    {
      $set: {
        encryptedPrivateKey,
        e2eeBackupVersion: backupVersion,
        e2eeBackupUpdatedAt: new Date(),
      },
    },
    {
      new: true,
      runValidators: true,
      ...options,
    },
  ).select(
    "+encryptedPrivateKey +e2eeBackupVersion +e2eeBackupUpdatedAt +publicKey",
  );

  if (options.session) query.session(options.session);

  return options.lean ? query.lean() : query;
};

export const findPublicKeysBatch = async (userIds, options = {}) => {
  const objectIds = userIds.map(toObjectId);
  const query = User.find({ _id: { $in: objectIds } }).select(
    "_id +publicKey publicKeyUpdatedAt",
  );

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const resetE2EEIdentity = async (userId, options = {}) => {
  const query = User.findByIdAndUpdate(
    toObjectId(userId),
    {
      $unset: {
        publicKey: 1,
        encryptedPrivateKey: 1,
        publicKeyUpdatedAt: 1,
        e2eeBackupVersion: 1,
        e2eeBackupUpdatedAt: 1,
      },
    },
    {
      new: true,
      ...options,
    },
  );

  if (options.session) query.session(options.session);

  return options.lean ? query.lean() : query;
};

const userKeyRepository = Object.freeze({
  findUserWithPublicKey,
  updateUserPublicKey,
  updateByUserId,
  findPublicKeyByUserId,
  findByUserId,
  existsByUserId,
  findE2EEStatus,
  registerInitialKeysAtomic,
  findEncryptedBackup,
  updateEncryptedBackup,
  findPublicKeysBatch,
  resetE2EEIdentity,
});

export default userKeyRepository;
