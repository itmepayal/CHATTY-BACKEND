import crypto from "crypto";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import User from "../../models/users.model.js";
import Session from "../../models/session.model.js";
import {
  RESET_TOKEN_BYTES,
  RESET_TOKEN_TTL_MS,
  AUTH_MESSAGES,
  serverUrl,
  clientUrl,
  appSchemeUrl,
} from "../../constants/constants.js";
import { hashToken, isValidResetToken } from "../../utils/token-hash.js";
import {
  sendPasswordResetEmail,
  openAppPageHtml,
} from "../../utils/email-service.js";
import {
  io,
  disconnectUser,
  disconnectOtherUserSessions,
} from "../../lib/socket.js";
import {
  normalizeEmail,
  validateForgotPasswordInput,
  validateResetPasswordInput,
  validateChangePasswordInput,
} from "../../validators/auth.validator.js";

export const requestPasswordReset = async ({ email, platform }) => {
  const normalised = normalizeEmail(email);
  validateForgotPasswordInput(normalised);

  const isMobile = platform === "mobile";
  const GENERIC_MSG = AUTH_MESSAGES.GENERIC_RESET_MSG;

  const user = await User.findOne({ email: normalised });
  if (!user) {
    return { message: GENERIC_MSG };
  }

  const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
  user.passwordResetToken = hashToken(rawToken);
  user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save({ validateBeforeSave: false });

  const resetUrl = isMobile
    ? `${serverUrl}/api/v1/auth/open-app/reset-password/${rawToken}`
    : `${clientUrl}/reset-password/${rawToken}`;

  try {
    await sendPasswordResetEmail(normalised, resetUrl);
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    console.error("[forgotPassword] email delivery failed:", err.message);
  }

  return { message: GENERIC_MSG };
};

export const getOpenAppResetHtml = (token) => {
  if (!isValidResetToken(token)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid or missing reset token.",
    );
  }

  const deepLink = `${appSchemeUrl}auth/new-password?token=${encodeURIComponent(token)}`;
  return openAppPageHtml(deepLink);
};

export const resetPassword = async ({ token, password, confirmPassword }) => {
  validateResetPasswordInput({ token, password, confirmPassword });

  const user = await User.findOne({
    passwordResetToken: hashToken(token),
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpires +tokenVersion");

  if (!user) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This password-reset link is invalid or has expired. Please request a new one.",
    );
  }

  user.password = password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  await user.save();

  await Session.updateMany(
    { userId: user._id },
    { $set: { revoked: true } },
  ).catch(() => {});

  io.to(String(user._id)).emit("session:revoked", { all: true });
  await disconnectUser(user._id);

  return { message: AUTH_MESSAGES.RESET_SUCCESS };
};

export const changePassword = async ({
  userId,
  currentSessionId,
  currentPassword,
  newPassword,
  confirmPassword,
}) => {
  validateChangePasswordInput({
    currentPassword,
    newPassword,
    confirmPassword,
  });

  const user = await User.findById(userId).select("+password");
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, AUTH_MESSAGES.USER_NOT_FOUND);
  }

  const isCurrentCorrect = await user.isPassword(currentPassword);
  if (!isCurrentCorrect) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Current password is incorrect.",
    );
  }

  user.password = newPassword;
  await user.save();

  if (currentSessionId) {
    await Session.updateMany(
      {
        userId: user._id,
        _id: { $ne: currentSessionId },
      },
      { $set: { revoked: true } },
    ).catch(() => {});

    io.to(String(user._id)).emit("session:revoke-others", {
      keepSessionId: currentSessionId,
    });
    await disconnectOtherUserSessions(user._id, currentSessionId);
  }

  return { message: AUTH_MESSAGES.PASSWORD_CHANGED };
};
