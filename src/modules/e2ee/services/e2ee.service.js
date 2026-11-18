import crypto from "crypto";
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
  { encryptedPrivateKey, backupVersion, expectedVersion, deviceId },
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

  // If deviceId provided, verify it is not revoked
  if (deviceId) {
    const dev = await deviceKeyRepository.findDeviceByUserAndId(
      userId,
      deviceId,
    );
    if (dev?.isRevoked) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Revoked device cannot update encryption backup.",
      );
    }
  }

  // Prevent stale backup overwrites & concurrent collision
  const currentVersion = user.e2eeBackupVersion || 1;
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Concurrent backup update detected. Expected version ${expectedVersion}, but current is ${currentVersion}.`,
    );
  }

  if (backupVersion && backupVersion < currentVersion) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      `Cannot overwrite newer backup version ${currentVersion} with older version ${backupVersion}.`,
    );
  }

  const nextVersion =
    backupVersion || (user.e2eeBackupVersion ? user.e2eeBackupVersion + 1 : 1);

  const updated = await userKeyRepository.updateEncryptedBackup(userId, {
    encryptedPrivateKey,
    backupVersion: nextVersion,
  });

  try {
    io.to(String(userId)).emit("e2ee:backup:updated", {
      backupVersion: updated.e2eeBackupVersion,
      backupUpdatedAt: updated.e2eeBackupUpdatedAt,
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit backup:updated socket event:",
      err?.message,
    );
  }

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

  // Invalidate any pending device link sessions for this user
  await deviceLinkRepository.deleteSessionsForUser(userId);

  // Invalidate any wrapped group keys distributed for the previous identity
  await groupKeyRepository.deleteForUser(userId);

  try {
    io.to(String(userId)).emit("e2ee:reset", { reset: true });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit e2ee:reset socket event:",
      err?.message,
    );
  }

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
  if (deviceId === "device-session-fallback") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Static fallback device ID is not permitted.",
    );
  }

  const user = await userKeyRepository.findE2EEStatus(userId);
  if (!user) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      E2EE_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  // Prevent silent re-registration of explicitly revoked devices
  const existing = await deviceKeyRepository.findDeviceByUserAndId(
    userId,
    deviceId,
  );
  if (existing?.isRevoked) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "This device has been revoked and cannot be registered without re-authorization.",
    );
  }

  // Prevent silent identity key replacement on active devices
  if (existing && !existing.isRevoked && existing.publicKey) {
    if (
      existing.publicKey.x !== publicKey.x ||
      existing.publicKey.y !== publicKey.y
    ) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "Device identity key cannot be replaced for an active device. Revoke the device first or re-link securely.",
      );
    }
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

  try {
    io.to(String(userId)).emit("e2ee:device:registered", {
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      publicKey: device.publicKey,
      createdAt: device.createdAt,
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit device:registered socket event:",
      err?.message,
    );
  }

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
 * Updates last active timestamp for an existing device.
 */
export const heartbeatDevice = async (userId, deviceId) => {
  if (!deviceId || deviceId === "device-session-fallback") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Valid device ID is required.");
  }

  const result = await deviceKeyRepository.updateDeviceActivity(
    userId,
    deviceId,
  );
  if (!result || result.matchedCount === 0) {
    const existing = await deviceKeyRepository.findDeviceByUserAndId(
      userId,
      deviceId,
    );
    if (existing?.isRevoked) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Device is revoked.");
    }
    return { active: false, registered: false, deviceId };
  }

  return { active: true, registered: true, deviceId, lastActiveAt: new Date() };
};

/**
 * Retrieves registered devices for the authenticated user.
 * Supports filtering active devices only (default) or including revoked devices.
 */
export const getDevices = async (userId, { includeRevoked = false } = {}) => {
  const devices = includeRevoked
    ? await deviceKeyRepository.findAllDevicesForUser(userId)
    : await deviceKeyRepository.findActiveDevicesForUser(userId);

  return {
    devices: devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      publicKey: d.publicKey,
      isRevoked: Boolean(d.isRevoked),
      lastActiveAt: d.lastActiveAt,
      createdAt: d.createdAt,
    })),
  };
};

/**
 * Revokes a device so it is no longer included in message key envelope wrapping.
 * Emits real-time notification to the user's active devices.
 */
export const revokeDevice = async (userId, deviceId) => {
  const updated = await deviceKeyRepository.revokeDevice(userId, deviceId);
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
  }

  try {
    io.to(String(userId)).emit("e2ee:device:revoked", {
      deviceId: updated.deviceId,
      revokedAt: updated.lastActiveAt || new Date(),
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit device:revoked socket event:",
      err?.message,
    );
  }

  return {
    revoked: true,
    deviceId: updated.deviceId,
  };
};

/**
 * Rotates an active device's public key securely.
 */
export const rotateDeviceKey = async (
  userId,
  { deviceId, newPublicKey, deviceName },
) => {
  if (!deviceId || deviceId === "device-session-fallback") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Valid device ID is required.");
  }

  const existing = await deviceKeyRepository.findDeviceByUserAndId(
    userId,
    deviceId,
  );
  if (!existing) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
  }
  if (existing.isRevoked) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Cannot rotate keys for a revoked device.",
    );
  }

  const updated = await deviceKeyRepository.upsertDeviceKey(userId, {
    deviceId,
    publicKey: {
      kty: "EC",
      crv: "P-256",
      x: newPublicKey.x,
      y: newPublicKey.y,
    },
    deviceName: deviceName || existing.deviceName,
  });

  try {
    io.to(String(userId)).emit("e2ee:device:rotated", {
      deviceId: updated.deviceId,
      publicKey: updated.publicKey,
      rotatedAt: updated.lastActiveAt,
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit device:rotated socket event:",
      err?.message,
    );
  }

  return {
    rotated: true,
    deviceId: updated.deviceId,
    deviceName: updated.deviceName,
    publicKey: updated.publicKey,
    lastActiveAt: updated.lastActiveAt,
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
  return String(crypto.randomInt(100000, 1000000));
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
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes (TTL)

  await deviceLinkRepository.createLinkSession({
    userId,
    linkSessionId,
    linkingPin,
    ephemeralPublicKey,
    newDeviceId: deviceId,
    newDeviceName: deviceName || "New Device",
    expiresAt,
  });

  console.log("[e2ee:device-link:create] Session created:", {
    userId: String(userId),
    linkSessionId,
    storedCode: linkingPin,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt.toISOString(),
    now: new Date().toISOString(),
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
  const cleanPin = String(linkingPin || "")
    .trim()
    .replace(/[\s-]+/g, "");
  const now = new Date();

  console.log("[e2ee:device-link:lookup] Session lookup requested:", {
    userId: String(userId),
    receivedCode: linkingPin,
    normalizedCode: cleanPin,
    now: now.toISOString(),
  });

  if (!cleanPin || cleanPin.length !== 6 || !/^\d{6}$/.test(cleanPin)) {
    console.log("[e2ee:device-link:lookup] Invalid PIN format:", {
      receivedCode: linkingPin,
      cleanPin,
    });
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid linking code. Please enter a valid 6-digit code.",
    );
  }

  const session = await deviceLinkRepository.findSessionByPin(userId, cleanPin);

  if (!session) {
    console.log("[e2ee:device-link:lookup] Session not found:", {
      userId: String(userId),
      cleanPin,
      now: now.toISOString(),
    });
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Invalid linking code. Pending session not found.",
    );
  }

  console.log("[e2ee:device-link:lookup] Session found:", {
    userId: String(userId),
    linkSessionId: session.linkSessionId,
    storedCode: session.linkingPin,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    now: now.toISOString(),
  });

  if (now > new Date(session.expiresAt) || session.status === "expired") {
    console.log("[e2ee:device-link:lookup] Session expired:", {
      linkSessionId: session.linkSessionId,
      expiresAt: session.expiresAt,
      now: now.toISOString(),
    });
    throw new ApiError(
      StatusCodes.GONE,
      "This device linking session has expired.",
    );
  }

  if (session.status === "cancelled") {
    console.log("[e2ee:device-link:lookup] Session cancelled:", {
      linkSessionId: session.linkSessionId,
    });
    throw new ApiError(
      StatusCodes.GONE,
      "This device linking session was cancelled.",
    );
  }

  if (session.status === "approved") {
    console.log("[e2ee:device-link:lookup] Session already approved:", {
      linkSessionId: session.linkSessionId,
    });
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Device linking session already used.",
    );
  }

  if (session.status !== "pending") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This device linking session is no longer active.",
    );
  }

  try {
    io.to(String(userId)).emit("e2ee:device-link:connecting", {
      linkSessionId: session.linkSessionId,
      newDeviceId: session.newDeviceId,
      newDeviceName: session.newDeviceName,
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit device-link:connecting socket event:",
      err?.message,
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
  const now = new Date();
  const cleanPin = linkingPin
    ? String(linkingPin)
        .trim()
        .replace(/[\s-]+/g, "")
    : undefined;

  console.log("[e2ee:device-link:approve] Session approval requested:", {
    userId: String(userId),
    linkSessionId,
    receivedCode: linkingPin,
    cleanCode: cleanPin,
    approverDeviceId,
    now: now.toISOString(),
  });

  let session = null;
  if (linkSessionId) {
    session = await deviceLinkRepository.findLinkSessionById(linkSessionId);
  } else if (cleanPin) {
    session = await deviceLinkRepository.findSessionByPin(userId, cleanPin);
  }

  if (!session) {
    console.log("[e2ee:device-link:approve] Session not found:", {
      userId: String(userId),
      linkSessionId,
      cleanPin,
      now: now.toISOString(),
    });
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Invalid linking code. Device linking session not found.",
    );
  }

  console.log("[e2ee:device-link:approve] Session found:", {
    userId: String(userId),
    linkSessionId: session.linkSessionId,
    storedCode: session.linkingPin,
    status: session.status,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    now: now.toISOString(),
  });

  if (String(session.userId) !== String(userId)) {
    console.log("[e2ee:device-link:approve] User mismatch:", {
      sessionUserId: String(session.userId),
      authUserId: String(userId),
    });
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Unauthorized device link approval.",
    );
  }

  if (now > new Date(session.expiresAt) || session.status === "expired") {
    console.log("[e2ee:device-link:approve] Session expired:", {
      linkSessionId: session.linkSessionId,
      expiresAt: session.expiresAt,
      now: now.toISOString(),
    });
    throw new ApiError(
      StatusCodes.GONE,
      "This device linking session has expired.",
    );
  }

  if (session.status === "cancelled") {
    console.log("[e2ee:device-link:approve] Session cancelled:", {
      linkSessionId: session.linkSessionId,
    });
    throw new ApiError(
      StatusCodes.GONE,
      "This device linking session was cancelled.",
    );
  }

  if (session.status === "approved") {
    // Idempotent retry: if already approved by this approver or payload already set
    console.log(
      "[e2ee:device-link:approve] Session already approved (idempotent check):",
      {
        linkSessionId: session.linkSessionId,
        sessionApproverDeviceId: session.approverDeviceId,
        approverDeviceId,
      },
    );
    if (
      session.approverDeviceId === approverDeviceId ||
      (!session.approverDeviceId && session.encryptedPayload)
    ) {
      return {
        success: true,
        linkSessionId: session.linkSessionId,
        newDeviceId: session.newDeviceId,
        alreadyApproved: true,
      };
    }
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Device linking session already used.",
    );
  }

  if (session.status !== "pending") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Device linking session is no longer pending.",
    );
  }

  await deviceLinkRepository.approveLinkSession(session.linkSessionId, {
    encryptedPayload,
    approverDeviceId,
  });

  console.log("[e2ee:device-link:approve] Session approved successfully:", {
    linkSessionId: session.linkSessionId,
    approverDeviceId,
    now: new Date().toISOString(),
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

/**
 * Cancels an active or pending device linking session.
 */
export const cancelDeviceLinkSession = async (userId, linkSessionId) => {
  const session = await deviceLinkRepository.findLinkSessionById(linkSessionId);
  if (!session || String(session.userId) !== String(userId)) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "Device linking session not found or unauthorized.",
    );
  }

  await deviceLinkRepository.cancelSession(linkSessionId, userId);

  try {
    io.to(String(userId)).emit("e2ee:device-link:cancelled", {
      linkSessionId,
    });
  } catch (err) {
    console.warn(
      "[e2ee] Failed to emit device-link:cancelled socket event:",
      err?.message,
    );
  }

  return {
    cancelled: true,
    linkSessionId,
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
  heartbeatDevice,
  getDevices,
  revokeDevice,
  getDevicesPublicKeys,
  requestDeviceLink,
  getDeviceLinkStatus,
  lookupPendingLinkSession,
  approveDeviceLink,
  cancelDeviceLinkSession,
};

export default e2eeService;
