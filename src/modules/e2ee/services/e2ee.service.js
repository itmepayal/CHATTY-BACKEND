import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import { isValidObjectId } from "../../../shared/utils/object-id.util.js";
import * as userKeyRepository from "../../users/repositories/user-key.repository.js";
import * as groupKeyRepository from "../../groups/repositories/group-key.repository.js";
import * as deviceKeyRepository from "../repositories/device-key.repository.js";
import {
  E2EE_ERROR_MESSAGES,
  E2EE_RESET_CONFIRM_KEYWORD,
  MAX_BATCH_PUBLIC_KEYS,
} from "../constants/e2ee.constants.js";

export const getStatus = async (userId) => {
  const user = await userKeyRepository.findE2EEStatus(userId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  const hasPublicKey = Boolean(user.publicKey);
  const hasBackup = Boolean(user.encryptedPrivateKey);

  return {
    hasPublicKey,
    hasKey: hasPublicKey,
    hasBackup,
    publicKeyUpdatedAt: user.publicKeyUpdatedAt || null,
    backupVersion: hasBackup ? user.e2eeBackupVersion || 1 : null,
    backupUpdatedAt: user.e2eeBackupUpdatedAt || null,
  };
};

export const registerKeys = async (
  userId,
  { publicKey, encryptedPrivateKey, backupVersion = 1 },
) => {
  const existing = await userKeyRepository.findE2EEStatus(userId);
  if (!existing) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  if (existing.publicKey) {
    const isSameKey =
      existing.publicKey.kty === publicKey.kty &&
      existing.publicKey.crv === publicKey.crv &&
      existing.publicKey.x === publicKey.x &&
      existing.publicKey.y === publicKey.y;

    if (isSameKey) {
      if (!existing.encryptedPrivateKey && encryptedPrivateKey) {
        const updated = await userKeyRepository.updateEncryptedBackup(userId, {
          encryptedPrivateKey,
          backupVersion: backupVersion || 1,
        });

        return {
          duplicate: false,
          attachedBackup: true,
          hasPublicKey: true,
          hasKey: true,
          hasBackup: true,
          publicKey: existing.publicKey,
          publicKeyUpdatedAt: existing.publicKeyUpdatedAt || null,
          backupVersion: updated.e2eeBackupVersion || 1,
          backupUpdatedAt: updated.e2eeBackupUpdatedAt || null,
        };
      }

      return {
        duplicate: true,
        hasPublicKey: true,
        hasKey: true,
        hasBackup: Boolean(existing.encryptedPrivateKey),
        publicKey: existing.publicKey,
        publicKeyUpdatedAt: existing.publicKeyUpdatedAt || null,
        backupVersion: existing.e2eeBackupVersion || 1,
        backupUpdatedAt: existing.e2eeBackupUpdatedAt || null,
      };
    }

    // Different key submitted: strictly reject silent identity replacement
    throw new ApiError(
      StatusCodes.CONFLICT,
      E2EE_ERROR_MESSAGES.KEY_ALREADY_EXISTS,
    );
  }

  // Atomic initial registration (concurrency safe)
  const registered = await userKeyRepository.registerInitialKeysAtomic(userId, {
    publicKey: {
      kty: "EC",
      crv: "P-256",
      x: publicKey.x,
      y: publicKey.y,
    },
    encryptedPrivateKey,
    backupVersion: backupVersion || 1,
  });

  if (!registered) {
    // If update returned null, another request registered concurrently
    const refreshed = await userKeyRepository.findE2EEStatus(userId);
    if (refreshed?.publicKey) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        E2EE_ERROR_MESSAGES.KEY_ALREADY_EXISTS,
      );
    }
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  return {
    hasPublicKey: true,
    hasKey: true,
    hasBackup: Boolean(registered.encryptedPrivateKey),
    publicKey: registered.publicKey,
    publicKeyUpdatedAt: registered.publicKeyUpdatedAt,
    backupVersion: registered.e2eeBackupVersion || 1,
    backupUpdatedAt: registered.e2eeBackupUpdatedAt,
  };
};

/**
 * Retrieves the encrypted private key backup for the authenticated user.
 */
export const getBackup = async (userId) => {
  const user = await userKeyRepository.findEncryptedBackup(userId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  if (!user.encryptedPrivateKey) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.BACKUP_NOT_FOUND,
    );
  }

  return {
    encryptedPrivateKey: user.encryptedPrivateKey,
    backupVersion: user.e2eeBackupVersion || 1,
    backupUpdatedAt: user.e2eeBackupUpdatedAt || null,
    publicKey: user.publicKey || null,
  };
};

/**
 * Updates the encrypted private key backup without altering the user's public key.
 */
export const updateBackup = async (
  userId,
  { encryptedPrivateKey, backupVersion },
) => {
  const user = await userKeyRepository.findE2EEStatus(userId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  if (!user.publicKey) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      E2EE_ERROR_MESSAGES.PUBLIC_KEY_REQUIRED,
    );
  }

  const nextVersion =
    backupVersion || (user.e2eeBackupVersion ? user.e2eeBackupVersion + 1 : 1);

  const updated = await userKeyRepository.updateEncryptedBackup(userId, {
    encryptedPrivateKey,
    backupVersion: nextVersion,
  });

  return {
    hasBackup: true,
    backupVersion: updated.e2eeBackupVersion,
    backupUpdatedAt: updated.e2eeBackupUpdatedAt,
  };
};

/**
 * Explicitly destructive reset operation requiring account password and keyword confirmation.
 */
export const resetKeys = async (userId, { password, confirm }) => {
  if (confirm !== E2EE_RESET_CONFIRM_KEYWORD) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      E2EE_ERROR_MESSAGES.CONFIRMATION_REQUIRED,
    );
  }

  const user = await userKeyRepository.findUserWithPublicKey(userId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  const isPasswordValid = await user.isPassword(String(password || ""));
  if (!isPasswordValid) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      E2EE_ERROR_MESSAGES.PASSWORD_INCORRECT,
    );
  }

  await userKeyRepository.resetE2EEIdentity(userId);

  // Invalidate any registered device keys for this user
  await deviceKeyRepository.deleteDevicesForUser(userId);

  // Invalidate any wrapped group keys distributed for the previous identity
  await groupKeyRepository.deleteForUser(userId);

  return {
    reset: true,
    warning:
      "Historical encrypted messages cannot be decrypted with future keys unless restored from an external backup.",
  };
};

/**
 * Fetches the public key of a specific user.
 */
export const getPublicKey = async (targetId) => {
  if (!isValidObjectId(targetId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      E2EE_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }

  const user = await userKeyRepository.findPublicKeyByUserId(targetId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  if (!user.publicKey) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.KEY_NOT_FOUND,
    );
  }

  return {
    userId: String(user._id),
    publicKey: user.publicKey,
    publicKeyUpdatedAt: user.publicKeyUpdatedAt || null,
  };
};

/**
 * Batch lookup of public keys for multiple users.
 */
export const getPublicKeysBatch = async (userIds) => {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      E2EE_ERROR_MESSAGES.BATCH_EMPTY,
    );
  }

  const uniqueIds = [...new Set(userIds.map(String))];
  if (uniqueIds.length > MAX_BATCH_PUBLIC_KEYS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      E2EE_ERROR_MESSAGES.BATCH_LIMIT_EXCEEDED,
    );
  }

  for (const id of uniqueIds) {
    if (!isValidObjectId(id)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `${E2EE_ERROR_MESSAGES.INVALID_USER_ID}: ${id}`,
      );
    }
  }

  const users = await userKeyRepository.findPublicKeysBatch(uniqueIds);
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const publicKeys = {};
  const keys = uniqueIds.map((id) => {
    const user = userMap.get(id);
    const hasKey = Boolean(user?.publicKey);
    if (hasKey) {
      publicKeys[id] = user.publicKey;
    }
    return {
      userId: id,
      hasKey,
      publicKey: user?.publicKey || null,
      publicKeyUpdatedAt: user?.publicKeyUpdatedAt || null,
    };
  });

  return {
    keys,
    publicKeys,
    count: Object.keys(publicKeys).length,
  };
};

/**
 * Registers or updates a device's public key for multi-device E2EE.
 */
export const registerDevice = async (
  userId,
  { deviceId, publicKey, deviceName },
) => {
  const user = await userKeyRepository.findE2EEStatus(userId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  const device = await deviceKeyRepository.upsertDeviceKey(userId, {
    deviceId,
    publicKey: {
      kty: "EC",
      crv: "P-256",
      x: publicKey.x,
      y: publicKey.y,
    },
    deviceName,
  });

  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    publicKey: device.publicKey,
    isRevoked: device.isRevoked,
    lastActiveAt: device.lastActiveAt,
    createdAt: device.createdAt,
  };
};

/**
 * Retrieves all active registered devices for the authenticated user.
 */
export const getDevices = async (userId) => {
  const devices = await deviceKeyRepository.findActiveDevicesForUser(userId);
  return {
    devices: devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      publicKey: d.publicKey,
      lastActiveAt: d.lastActiveAt,
      createdAt: d.createdAt,
    })),
  };
};

/**
 * Revokes a device so it is no longer included in message key envelope wrapping.
 */
export const revokeDevice = async (userId, deviceId) => {
  const updated = await deviceKeyRepository.revokeDevice(userId, deviceId);
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
  }
  return {
    revoked: true,
    deviceId: updated.deviceId,
  };
};

/**
 * Batch lookup of active device public keys for an array of userIds.
 * Supports multi-device envelopes: returns all active devices per user.
 * If a user has no device keys registered yet, includes fallback to primary account publicKey.
 */
export const getDevicesPublicKeys = async (userIds) => {
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      E2EE_ERROR_MESSAGES.BATCH_EMPTY,
    );
  }

  const uniqueIds = [...new Set(userIds.map(String))];
  if (uniqueIds.length > MAX_BATCH_PUBLIC_KEYS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      E2EE_ERROR_MESSAGES.BATCH_LIMIT_EXCEEDED,
    );
  }

  for (const id of uniqueIds) {
    if (!isValidObjectId(id)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `${E2EE_ERROR_MESSAGES.INVALID_USER_ID}: ${id}`,
      );
    }
  }

  const [activeDevices, primaryUsers] = await Promise.all([
    deviceKeyRepository.findActiveDevicesForUsers(uniqueIds),
    userKeyRepository.findPublicKeysBatch(uniqueIds),
  ]);

  const primaryUserMap = new Map(primaryUsers.map((u) => [String(u._id), u]));
  const userDevices = {};

  for (const uid of uniqueIds) {
    userDevices[uid] = [];
  }

  for (const device of activeDevices) {
    const uid = String(device.userId);
    if (userDevices[uid]) {
      userDevices[uid].push({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        publicKey: device.publicKey,
      });
    }
  }

  // Fallback: If a user has no device keys registered, but has a primary publicKey,
  // provide a default device entry ("default") so sender wraps key for primary key
  for (const uid of uniqueIds) {
    if (userDevices[uid].length === 0) {
      const primaryUser = primaryUserMap.get(uid);
      if (primaryUser?.publicKey) {
        userDevices[uid].push({
          deviceId: "default",
          deviceName: "Primary Device",
          publicKey: primaryUser.publicKey,
        });
      }
    }
  }

  const allDevices = [];
  for (const [userId, devices] of Object.entries(userDevices)) {
    for (const d of devices) {
      allDevices.push({
        userId,
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        publicKey: d.publicKey,
      });
    }
  }

  return {
    devices: allDevices,
    userDevices,
    count: allDevices.length,
  };
};

const e2eeService = {
  getStatus,
  registerKeys,
  getBackup,
  updateBackup,
  resetKeys,
  getPublicKey,
  getPublicKeysBatch,
  registerDevice,
  getDevices,
  revokeDevice,
  getDevicesPublicKeys,
};

export default e2eeService;
