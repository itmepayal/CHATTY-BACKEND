import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import * as userRepository from "../repositories/user.repository.js";
import {
  generateUnlockToken,
  verifyUnlockToken,
  verifyPinHash,
  hashPin,
  UNLOCK_TOKEN_EXPIRY_SECONDS,
} from "../utils/lock-token.util.js";
import { refreshPrivacy } from "../../../infrastructure/socket/socket.js";

const getLockoutCooldownSeconds = (attempts) => {
  if (attempts >= 7) return 300; // 5 minutes
  if (attempts >= 6) return 60;  // 1 minute
  if (attempts >= 5) return 30;  // 30 seconds
  return 0;
};

export const verifyLockPin = async ({
  userId,
  pin,
  chatId,
  scope,
  sessionId,
  ip = "unknown",
}) => {
  const user = await userRepository
    .findById(userId)
    .select("+appLockPinHash +lockFailedAttempts +lockoutUntil +lockEpoch");

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  // 1. Lockout check
  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    const remainingSeconds = Math.max(
      1,
      Math.ceil((user.lockoutUntil.getTime() - Date.now()) / 1000),
    );
    const err = new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      `App is locked. Try again in ${remainingSeconds} seconds.`,
    );
    err.code = "LOCKED_OUT";
    err.lockoutUntil = user.lockoutUntil;
    err.remainingSeconds = remainingSeconds;
    throw err;
  }

  // 2. Config check
  if (!user.appLockPinHash) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "App Lock PIN is not configured on the server.",
    );
  }

  // 3. Verify PIN
  const isMatch = await verifyPinHash(pin, user.appLockPinHash);

  if (!isMatch) {
    const newAttempts = (user.lockFailedAttempts || 0) + 1;
    const cooldown = getLockoutCooldownSeconds(newAttempts);
    const lockoutUntil =
      cooldown > 0 ? new Date(Date.now() + cooldown * 1000) : null;

    await userRepository.findByIdAndUpdate(userId, {
      lockFailedAttempts: newAttempts,
      lockoutUntil,
    });

    console.warn(
      `[lock:verify] Failed PIN attempt for user ${userId} from IP ${ip} (attempt ${newAttempts})`,
    );

    if (cooldown > 0) {
      const err = new ApiError(
        StatusCodes.TOO_MANY_REQUESTS,
        `Too many failed attempts. Locked for ${cooldown} seconds.`,
      );
      err.code = "LOCKED_OUT";
      err.lockoutUntil = lockoutUntil;
      err.remainingSeconds = cooldown;
      throw err;
    } else {
      const remainingAttempts = Math.max(0, 5 - newAttempts);
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "Incorrect PIN.",
        { remainingAttempts },
      );
    }
  }

  // 4. Success -> Reset failed attempts
  await userRepository.findByIdAndUpdate(userId, {
    lockFailedAttempts: 0,
    lockoutUntil: null,
  });

  console.log(`[lock:verify] Successful PIN verification for user ${userId} from IP ${ip}`);

  const targetScope = scope || (chatId ? String(chatId) : "app");
  const unlockToken = generateUnlockToken({
    userId,
    sessionId,
    scope: targetScope,
    lockEpoch: user.lockEpoch || 0,
  });

  return {
    unlockToken,
    scope: targetScope,
    expiresIn: UNLOCK_TOKEN_EXPIRY_SECONDS,
  };
};

export const setupLockPin = async ({
  userId,
  pin,
  timeout = "immediately",
  sessionId,
  ip = "unknown",
}) => {
  const user = await userRepository.findById(userId).select("+lockEpoch");
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const pinHash = await hashPin(pin);
  const nextEpoch = (user.lockEpoch || 0) + 1;

  await userRepository.findByIdAndUpdate(userId, {
    appLockPinHash: pinHash,
    appLockEnabled: true,
    appLockTimeout: timeout,
    lockFailedAttempts: 0,
    lockoutUntil: null,
    lockEpoch: nextEpoch,
  });

  console.log(`[lock:setup] App Lock configured for user ${userId} from IP ${ip}`);

  await refreshPrivacy(userId);

  const unlockToken = generateUnlockToken({
    userId,
    sessionId,
    scope: "app",
    lockEpoch: nextEpoch,
  });

  return {
    unlockToken,
    scope: "app",
    expiresIn: UNLOCK_TOKEN_EXPIRY_SECONDS,
    appLockEnabled: true,
    appLockTimeout: timeout,
  };
};

export const disableLockPin = async ({
  userId,
  pin,
  password,
  unlockToken,
  ip = "unknown",
}) => {
  const user = await userRepository
    .findById(userId)
    .select("+password +appLockPinHash +lockEpoch");

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  let authorized = false;

  if (unlockToken) {
    const decoded = verifyUnlockToken(unlockToken);
    if (
      decoded &&
      decoded.userId === String(userId) &&
      decoded.scope === "app" &&
      decoded.lockEpoch >= (user.lockEpoch || 0)
    ) {
      authorized = true;
    }
  }

  if (!authorized && pin && user.appLockPinHash) {
    authorized = await verifyPinHash(pin, user.appLockPinHash);
  }

  if (!authorized && password && user.password) {
    authorized = await user.isPassword(password);
  }

  if (!authorized) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Valid PIN, account password, or app unlock token is required to disable App Lock.",
    );
  }

  const nextEpoch = (user.lockEpoch || 0) + 1;

  await userRepository.findByIdAndUpdate(userId, {
    appLockEnabled: false,
    appLockPinHash: null,
    lockFailedAttempts: 0,
    lockoutUntil: null,
    lockEpoch: nextEpoch,
  });

  console.log(`[lock:disable] App Lock disabled for user ${userId} from IP ${ip}`);

  await refreshPrivacy(userId);

  return {
    message: "App Lock disabled successfully.",
    appLockEnabled: false,
  };
};
