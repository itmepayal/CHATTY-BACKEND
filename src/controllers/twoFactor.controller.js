import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/users.model.js";
import Session from "../models/session.model.js";
import { StatusCodes } from "http-status-codes";
import QRCode from "qrcode";
import {
  generateSecret,
  buildOtpUri,
  encryptSecret,
  verifyTotpToken,
  generateRecoveryCodes,
  consumeRecoveryCode,
  verifyChallengeToken,
} from "../utils/totp.js";
import { options as cookieOptions } from "../constants/constant.js";
import { parseDevice, getIp, sanitizeIp } from "../utils/deviceInfo.js";
import { sendLoginAlertEmail } from "../utils/emailService.js";

const failedAttempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function checkRateLimit(userId) {
  const now = Date.now();
  const key = String(userId);
  const rec = failedAttempts.get(key);
  if (!rec) return;
  if (now > rec.resetAt) {
    failedAttempts.delete(key);
    return;
  }
  if (rec.count >= MAX_ATTEMPTS) {
    const wait = Math.ceil((rec.resetAt - now) / 60000);
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      `Too many attempts. Try again in ${wait} minute${wait !== 1 ? "s" : ""}.`,
    );
  }
}

export function recordFail(userId) {
  const now = Date.now();
  const key = String(userId);
  let rec = failedAttempts.get(key);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
  }
  rec.count += 1;
  failedAttempts.set(key, rec);
}

export function clearFail(userId) {
  failedAttempts.delete(String(userId));
}

export const setup2FA = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select(
    "+twoFactorPendingSecret +twoFactorSecret",
  );

  if (user.twoFactorEnabled) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Two-step verification is already enabled.",
    );
  }

  const secret = generateSecret();
  const otpUri = buildOtpUri(secret, user.email);
  const qrCodeUrl = await QRCode.toDataURL(otpUri);
  const encrypted = encryptSecret(secret);

  user.twoFactorPendingSecret = encrypted;
  await user.save({ validateBeforeSave: false });

  return new ApiResponse(
    StatusCodes.OK,
    {
      qrCodeUrl,
      manualKey: secret.replace(/(.{4})/g, "$1 ").trim(),
    },
    "Scan the QR code with your authenticator app, then verify with a code.",
  ).send(res);
});

export const enable2FA = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code)
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Verification code is required.",
    );

  const user = await User.findById(req.user._id).select(
    "+twoFactorPendingSecret +twoFactorSecret",
  );

  if (!user.twoFactorPendingSecret) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No pending 2FA setup found. Start setup first.",
    );
  }

  checkRateLimit(req.user._id);

  const valid = verifySetupCode(user, code);
  if (!valid) {
    recordFail(req.user._id);
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Invalid or expired verification code.",
    );
  }

  clearFail(req.user._id);

  const { codes, hashes } = await generateRecoveryCodes();
  user.twoFactorSecret = user.twoFactorPendingSecret;
  user.twoFactorPendingSecret = undefined;
  user.twoFactorEnabled = true;
  user.recoveryCodes = hashes;
  await user.save({ validateBeforeSave: false });

  return new ApiResponse(
    StatusCodes.OK,
    {
      recoveryCodes: codes,
      warning:
        "Save these recovery codes somewhere safe. They will not be shown again.",
    },
    "Two-step verification enabled successfully.",
  ).send(res);
});

export const verifyLogin2FA = asyncHandler(async (req, res) => {
  const { challengeToken, code, useRecoveryCode } = req.body;

  if (!challengeToken || !code) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Challenge token and code are required.",
    );
  }

  let decoded;
  try {
    decoded = verifyChallengeToken(challengeToken);
  } catch {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Challenge expired or invalid. Please log in again.",
    );
  }

  const user = await User.findById(decoded.id).select(
    "+twoFactorSecret +recoveryCodes +loginAlerts",
  );

  if (!user || !user.twoFactorEnabled) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "2FA is not enabled for this account.",
    );
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

  const deviceInfo = parseDevice(req.headers["user-agent"]);
  const rawIp = getIp(req);
  const session = await Session.create({
    userId: user._id,
    device: deviceInfo,
    ip: sanitizeIp(rawIp),
    location: "Location unavailable",
  });

  const { accessToken, refreshToken } = await User.generateToken(
    user._id,
    session._id,
  );

  if (user.loginAlerts) {
    const time = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });
    sendLoginAlertEmail(user.email, {
      deviceLabel: deviceInfo.label,
      location: "Location unavailable",
      time,
    }).catch(() => {});
  }

  res
    .cookie("accessToken", accessToken, cookieOptions)
    .cookie("refreshToken", refreshToken, cookieOptions);

  return new ApiResponse(
    StatusCodes.OK,
    {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar?.url,
      twoFactorEnabled: true,
      token: { accessToken, refreshToken },
    },
    "Two-factor verification successful.",
  ).send(res);
});

export const disable2FA = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Current authenticator code is required to disable 2FA.",
    );
  }

  const user = await User.findById(req.user._id).select("+twoFactorSecret");

  if (!user.twoFactorEnabled) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Two-step verification is not enabled.",
    );
  }

  checkRateLimit(req.user._id);

  const valid = verifyTotpToken(String(code).trim(), user.twoFactorSecret);
  if (!valid) {
    recordFail(req.user._id);
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid authenticator code.");
  }

  clearFail(req.user._id);

  user.twoFactorEnabled = false;
  user.twoFactorSecret = undefined;
  user.twoFactorPendingSecret = undefined;
  user.recoveryCodes = [];
  await user.save({ validateBeforeSave: false });

  return new ApiResponse(
    StatusCodes.OK,
    null,
    "Two-step verification disabled.",
  ).send(res);
});

export const regenerateRecoveryCodes = asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Current authenticator code is required.",
    );
  }

  const user = await User.findById(req.user._id).select(
    "+twoFactorSecret +recoveryCodes",
  );

  if (!user.twoFactorEnabled) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Two-step verification is not enabled.",
    );
  }

  checkRateLimit(req.user._id);

  const valid = verifyTotpToken(String(code).trim(), user.twoFactorSecret);
  if (!valid) {
    recordFail(req.user._id);
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid authenticator code.");
  }

  clearFail(req.user._id);

  const { codes, hashes } = await generateRecoveryCodes();
  user.recoveryCodes = hashes;
  await user.save({ validateBeforeSave: false });

  return new ApiResponse(
    StatusCodes.OK,
    {
      recoveryCodes: codes,
      warning:
        "Your previous recovery codes have been invalidated. Save these new ones.",
    },
    "Recovery codes regenerated.",
  ).send(res);
});

const verifySetupCode = (user, code) => {
  const value = String(code).trim();
  return verifyTotpToken(value, user.twoFactorPendingSecret);
};

const verifyCurrentCode = (user, code) => {
  const value = String(code).trim();
  return verifyTotpToken(value, user.twoFactorSecret);
};
