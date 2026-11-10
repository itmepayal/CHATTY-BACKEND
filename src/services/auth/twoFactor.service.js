import QRCode from "qrcode";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import * as userRepository from "../../repositories/users/user.repository.js";
import {
  generateSecret,
  buildOtpUri,
  encryptSecret,
  verifyTotpToken,
  generateRecoveryCodes,
  consumeRecoveryCode,
  verifyChallengeToken,
} from "../../utils/totp.js";
import {
  checkRateLimit,
  recordFail,
  clearFail,
} from "../../utils/two-factor-rate-limit.js";
import { createLoginSession } from "./session.service.js";
import {
  validate2FAVerifyLoginInput,
  validateTotpCodeInput,
} from "../../validations/auth.validation.js";
import { AUTH_MESSAGES } from "../../constants/auth.constants.js";

export const setup2FA = async (userId) => {
  const user = await userRepository.findById(userId).select(
    "+twoFactorPendingSecret +twoFactorSecret",
  );

  if (user.twoFactorEnabled) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      AUTH_MESSAGES.TWO_FA_ALREADY_ENABLED,
    );
  }

  const secret = generateSecret();
  const otpUri = buildOtpUri(secret, user.email);
  const qrCodeUrl = await QRCode.toDataURL(otpUri);
  const encrypted = encryptSecret(secret);

  user.twoFactorPendingSecret = encrypted;
  await user.save({ validateBeforeSave: false });

  return {
    qrCodeUrl,
    manualKey: secret.replace(/(.{4})/g, "$1 ").trim(),
  };
};

export const enable2FA = async ({ userId, code }) => {
  validateTotpCodeInput(code, "Verification code is required.");

  const user = await userRepository.findById(userId).select(
    "+twoFactorPendingSecret +twoFactorSecret",
  );

  if (!user.twoFactorPendingSecret) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No pending 2FA setup found. Start setup first.",
    );
  }

  checkRateLimit(userId);

  const valid = verifyTotpToken(
    String(code).trim(),
    user.twoFactorPendingSecret,
  );
  if (!valid) {
    recordFail(userId);
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Invalid or expired verification code.",
    );
  }

  clearFail(userId);

  const { codes, hashes } = await generateRecoveryCodes();
  user.twoFactorSecret = user.twoFactorPendingSecret;
  user.twoFactorPendingSecret = undefined;
  user.twoFactorEnabled = true;
  user.recoveryCodes = hashes;
  await user.save({ validateBeforeSave: false });

  return {
    recoveryCodes: codes,
    warning: AUTH_MESSAGES.RECOVERY_CODES_WARNING,
  };
};

export const verifyLogin2FA = async ({
  challengeToken,
  code,
  useRecoveryCode,
  userAgent,
  ip,
}) => {
  validate2FAVerifyLoginInput({ challengeToken, code });

  let decoded;
  try {
    decoded = verifyChallengeToken(challengeToken);
  } catch {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Challenge expired or invalid. Please log in again.",
    );
  }

  const user = await userRepository.findById(decoded.id).select(
    "+twoFactorSecret +recoveryCodes +loginAlerts",
  );

  if (!user || !user.twoFactorEnabled) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "2FA is not enabled for this account.",
    );
  }

  if (user.status === "suspended") {
    throw new ApiError(StatusCodes.FORBIDDEN, AUTH_MESSAGES.ACCOUNT_SUSPENDED);
  }

  checkRateLimit(user._id);

  if (useRecoveryCode) {
    const idx = await consumeRecoveryCode(
      String(code).trim(),
      user.recoveryCodes || [],
    );
    if (idx === -1) {
      recordFail(user._id);
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid recovery code.");
    }
    user.recoveryCodes.splice(idx, 1);
    user.markModified("recoveryCodes");
    await user.save({ validateBeforeSave: false });
  } else {
    const verified = verifyTotpToken(String(code).trim(), user.twoFactorSecret);
    if (!verified) {
      recordFail(user._id);
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "Invalid or expired authenticator code.",
      );
    }
  }

  clearFail(user._id);

  const { accessToken, refreshToken } = await createLoginSession(user, {
    userAgent,
    ip,
  });

  return {
    user,
    accessToken,
    refreshToken,
  };
};

export const disable2FA = async ({ userId, code }) => {
  validateTotpCodeInput(
    code,
    "Current authenticator code is required to disable 2FA.",
  );

  const user = await userRepository.findById(userId).select("+twoFactorSecret");

  if (!user.twoFactorEnabled) {
    throw new ApiError(StatusCodes.CONFLICT, AUTH_MESSAGES.TWO_FA_NOT_ENABLED);
  }

  checkRateLimit(userId);

  const valid = verifyTotpToken(String(code).trim(), user.twoFactorSecret);
  if (!valid) {
    recordFail(userId);
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid authenticator code.");
  }

  clearFail(userId);

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.recoveryCodes = [];
  await user.save({ validateBeforeSave: false });
};

export const regenerateRecoveryCodes = async ({ userId, code }) => {
  validateTotpCodeInput(code, "Current authenticator code is required.");

  const user = await userRepository.findById(userId).select(
    "+twoFactorSecret +recoveryCodes",
  );

  if (!user.twoFactorEnabled) {
    throw new ApiError(StatusCodes.CONFLICT, AUTH_MESSAGES.TWO_FA_NOT_ENABLED);
  }

  checkRateLimit(userId);

  const valid = verifyTotpToken(String(code).trim(), user.twoFactorSecret);
  if (!valid) {
    recordFail(userId);
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid authenticator code.");
  }

  clearFail(userId);

  const { codes, hashes } = await generateRecoveryCodes();
  user.recoveryCodes = hashes;
  await user.save({ validateBeforeSave: false });

  return {
    recoveryCodes: codes,
    warning: AUTH_MESSAGES.RECOVERY_CODES_REGEN_WARNING,
  };
};

const twoFactorService = {
  setup2FA,
  enable2FA,
  verifyLogin2FA,
  disable2FA,
  regenerateRecoveryCodes,
};

export default twoFactorService;

