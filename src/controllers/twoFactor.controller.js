import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/api-error.js";
import ApiResponse from "../utils/api-response.js";
import User from "../models/users.model.js";
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
import { options as cookieOptions } from "../constants/constants.js";
import { createLoginSession } from "../services/session.service.js";
import {
  checkRateLimit,
  recordFail,
  clearFail,
} from "../utils/two-factor-rate-limit.js";

const twoFactorController = {
  setup2FA: asyncHandler(async (req, res) => {
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
  }),

  enable2FA: asyncHandler(async (req, res) => {
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

    const valid = verifyTotpToken(
      String(code).trim(),
      user.twoFactorPendingSecret,
    );
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
  }),

  verifyLogin2FA: asyncHandler(async (req, res) => {
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

    const { accessToken, refreshToken } = await createLoginSession(req, user);

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
  }),

  disable2FA: asyncHandler(async (req, res) => {
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
  }),

  regenerateRecoveryCodes: asyncHandler(async (req, res) => {
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
  }),
};

export default twoFactorController;
