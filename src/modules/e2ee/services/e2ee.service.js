import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import { isValidObjectId } from "../../../shared/utils/object-id.util.js";
import * as userKeyRepository from "../../users/repositories/user-key.repository.js";
import * as groupKeyRepository from "../../groups/repositories/group-key.repository.js";
import * as deviceKeyRepository from "../repositories/device-key.repository.js";
import * as deviceLinkRepository from "../repositories/device-link.repository.js";
import { io } from "../../../infrastructure/socket/socket.js";
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

const generatePin = () => {
  const part1 = Math.floor(100 + Math.random() * 900);
  const part2 = Math.floor(100 + Math.random() * 900);
  return `${part1}-${part2}`;
};

/**
 * Initiates a device linking session for a new device.
 */
export const requestDeviceLink = async (
  userId,
  { ephemeralPublicKey, deviceId, deviceName },
) => {
  const user = await userKeyRepository.findE2EEStatus(userId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  const linkSessionId = crypto.randomUUID();
  const linkingPin = generatePin();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  await deviceLinkRepository.createLinkSession({
    userId,
    linkSessionId,
    linkingPin,
    ephemeralPublicKey,
    newDeviceId: deviceId,
    newDeviceName: deviceName || "New Device",
    expiresAt,
  });

  try {
    io.to(String(userId)).emit("e2ee:device-link:requested", {
      linkSessionId,
      linkingPin,
      newDeviceId: deviceId,
      newDeviceName: deviceName || "New Device",
      expiresAt,
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit device-link:requested socket event:",
      err?.message,
    );
  }

  return {
    linkSessionId,
    linkingPin,
    expiresAt,
  };
};

/**
 * Checks the status of a pending device linking session.
 */
export const getDeviceLinkStatus = async (userId, linkSessionId) => {
  const session = await deviceLinkRepository.findLinkSessionById(linkSessionId);
  if (!session || String(session.userId) !== String(userId)) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Device linking session not found or unauthorized.",
    );
  }

  if (new Date() > new Date(session.expiresAt)) {
    return { status: "expired" };
  }

  if (session.status === "approved" && session.encryptedPayload) {
    // Delete session after successful read (one-time consume)
    await deviceLinkRepository.deleteLinkSession(linkSessionId).catch(() => {});

    return {
      status: "approved",
      encryptedPayload: session.encryptedPayload,
      approverDeviceId: session.approverDeviceId,
    };
  }

  return {
    status: session.status,
    linkingPin: session.linkingPin,
    expiresAt: session.expiresAt,
  };
};

/**
 * Looks up a pending device link session by linking PIN for the authenticated user.
 */
export const lookupPendingLinkSession = async (userId, linkingPin) => {
  const cleanPin = String(linkingPin).trim().replace(/\s+/g, "");
  const session = await deviceLinkRepository.findPendingSessionByPin(
    userId,
    cleanPin,
  );

  if (!session) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Pending device linking session not found or has expired.",
    );
  }

  if (new Date() > new Date(session.expiresAt)) {
    throw new ApiError(
      StatusCodes.GONE,
      "This device linking session has expired.",
    );
  }

  return {
    linkSessionId: session.linkSessionId,
    linkingPin: session.linkingPin,
    ephemeralPublicKey: session.ephemeralPublicKey,
    newDeviceId: session.newDeviceId,
    newDeviceName: session.newDeviceName,
    expiresAt: session.expiresAt,
  };
};

/**
 * Approves a device linking session from an existing trusted device.
 */
export const approveDeviceLink = async (
  userId,
  { linkSessionId, linkingPin, encryptedPayload, approverDeviceId },
) => {
  let session = null;
  if (linkSessionId) {
    session = await deviceLinkRepository.findLinkSessionById(linkSessionId);
  } else if (linkingPin) {
    session = await deviceLinkRepository.findPendingSessionByPin(
      userId,
      linkingPin,
    );
  }

  if (!session) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Device linking session not found or has expired.",
    );
  }

  if (String(session.userId) !== String(userId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Unauthorized device link approval.",
    );
  }

  if (
    session.status !== "pending" ||
    new Date() > new Date(session.expiresAt)
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Device linking session is no longer pending or has expired.",
    );
  }

  await deviceLinkRepository.approveLinkSession(session.linkSessionId, {
    encryptedPayload,
    approverDeviceId,
  });

  try {
    io.to(String(userId)).emit("e2ee:device-link:approved", {
      linkSessionId: session.linkSessionId,
      encryptedPayload,
      approverDeviceId,
      newDeviceId: session.newDeviceId,
    });
    io.to(String(userId)).emit("e2ee:device-link:completed", {
      deviceId: session.newDeviceId,
      deviceName: session.newDeviceName,
      approverDeviceId,
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit device-link:approved socket event:",
      err?.message,
    );
  }

  return {
    success: true,
    linkSessionId: session.linkSessionId,
    newDeviceId: session.newDeviceId,
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
  requestDeviceLink,
  getDeviceLinkStatus,
  approveDeviceLink,
};

export default e2eeService;
