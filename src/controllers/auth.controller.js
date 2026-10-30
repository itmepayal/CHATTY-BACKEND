import crypto from "crypto";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";

import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/api-error.js";
import ApiResponse from "../utils/api-response.js";
import {
  options,
  refreshTokenScret,
  clientUrl,
  RESET_TOKEN_BYTES,
  RESET_TOKEN_TTL_MS,
} from "../constants/constants.js";
import { uploadFileToCloudinary } from "../config/cloudinary.config.js";
import User from "../models/users.model.js";
import Session from "../models/session.model.js";
import { sendPasswordResetEmail } from "../utils/email-service.js";
import { signChallengeToken } from "../utils/totp.js";
import { prefsPayload } from "../utils/user-prefs.js";
import { createLoginSession } from "../services/session.service.js";
import { hashToken } from "../utils/token-hash.js";

const authController = {
  registerUser: asyncHandler(async (req, res) => {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Full name, email, and password are required.",
      );
    }

    const avatarLocalFile = req.file?.path;

    if (!avatarLocalFile) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Avatar file is required.");
    }

    const userExists = await User.findOne({ email });

    if (userExists) {
      throw new ApiError(StatusCodes.CONFLICT, "Email already registered.");
    }

    const avatar = await uploadFileToCloudinary(avatarLocalFile);

    if (!avatar || !avatar.public_id || !avatar.secure_url) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload avatar.");
    }

    const user = await User.create({
      fullName,
      email,
      password,
      avatar: {
        public_id: avatar.public_id,
        url: avatar.secure_url,
      },
    });

    const { accessToken, refreshToken } = await User.generateToken(user._id);

    res
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options);

    return new ApiResponse(
      StatusCodes.CREATED,
      {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar.url,
        ...prefsPayload(user),
        token: { accessToken, refreshToken },
      },
      "User registered successfully",
    ).send(res);
  }),

  loginUser: asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Email and password are required",
      );
    }

    const user = await User.findOne({ email }).select(
      "+twoFactorSecret +twoFactorEnabled +loginAlerts",
    );

    if (!user) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "User email not found");
    }

    const isMatch = await user.isPassword(password);
    if (!isMatch) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Incorrect password");
    }

    if (user.twoFactorEnabled) {
      const challengeToken = signChallengeToken(user);

      return new ApiResponse(
        StatusCodes.OK,
        { twoFactorRequired: true, challengeToken },
        "Two-factor verification required.",
      ).send(res);
    }

    const { accessToken, refreshToken } = await createLoginSession(req, user);

    res
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", refreshToken, options);

    return new ApiResponse(
      StatusCodes.CREATED,
      {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        avatar: user.avatar?.url,
        ...prefsPayload(user),
        token: { accessToken, refreshToken },
      },
      "User login successfully",
    ).send(res);
  }),

  logoutUser: asyncHandler(async (req, res) => {
    const token = req.cookies?.refreshToken;

    if (!token) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Refresh token is required.");
    }

    let decoded;
    try {
      decoded = jwt.verify(token, refreshTokenScret);
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          "Refresh token has expired.",
        );
      }
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid refresh token.");
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not found.");
    }

    if (req.sessionId) {
      await Session.findByIdAndUpdate(req.sessionId, {
        $set: { revoked: true },
      }).catch(() => { });
    }

    res
      .clearCookie("accessToken", options)
      .clearCookie("refreshToken", options);

    return new ApiResponse(
      StatusCodes.OK,
      null,
      "Logged out successfully.",
    ).send(res);
  }),

  checkAuth: asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Not authenticated.");
    }

    return new ApiResponse(
      StatusCodes.OK,
      {
        id: req.user._id,
        fullName: req.user.fullName,
        email: req.user.email,
        avatar: req.user.avatar?.url,
        twoFactorEnabled: req.user.twoFactorEnabled ?? false,
        loginAlerts: req.user.loginAlerts ?? true,
        ...prefsPayload(req.user),
      },
      "Authenticated user fetched successfully",
    ).send(res);
  }),

  forgotPassword: asyncHandler(async (req, res) => {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Email is required.");
    }

    const normalised = email.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Enter a valid email address.",
      );
    }

    const GENERIC_MSG =
      "If an account exists with this email address, you will receive instructions to reset your password.";

    const user = await User.findOne({ email: normalised });

    if (!user) {
      return new ApiResponse(StatusCodes.OK, null, GENERIC_MSG).send(res);
    }

    const rawToken = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");
    user.passwordResetToken = hashToken(rawToken);
    user.passwordResetExpires = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${clientUrl}/reset-password/${rawToken}`;

    try {
      await sendPasswordResetEmail(normalised, resetUrl);
    } catch (err) {
      user.passwordResetToken = undefined;
      user.passwordResetExpires = undefined;
      await user.save({ validateBeforeSave: false });

      console.error("[forgotPassword] email delivery failed:", err.message);
      throw new ApiError(
        StatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to send the reset email. Please try again later.",
      );
    }

    return new ApiResponse(StatusCodes.OK, null, GENERIC_MSG).send(res);
  }),

  resetPassword: asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (!token || typeof token !== "string" || token.length < 10) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid or missing reset token.",
      );
    }
    if (!password || !confirmPassword) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Both password fields are required.",
      );
    }
    if (password !== confirmPassword) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Passwords do not match.");
    }
    if (password.length < 6 || password.length > 15) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Password must be between 6 and 15 characters.",
      );
    }

    const hashedToken = hashToken(token);
    const user = await User.findOne({
      passwordResetToken: hashedToken,
      passwordResetExpires: { $gt: new Date() },
    }).select("+passwordResetToken +passwordResetExpires");

    if (!user) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "This password-reset link is invalid or has expired. Please request a new one.",
      );
    }

    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    return new ApiResponse(
      StatusCodes.OK,
      null,
      "Your password has been reset successfully. You can now log in with your new password.",
    ).send(res);
  }),

  changePassword: asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "All three password fields are required.",
      );
    }

    if (newPassword.length < 6 || newPassword.length > 15) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "New password must be between 6 and 15 characters.",
      );
    }

    if (newPassword !== confirmPassword) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "New password and confirmation do not match.",
      );
    }

    if (currentPassword === newPassword) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "New password must be different from your current password.",
      );
    }

    const user = await User.findById(req.user._id).select("+password");
    if (!user) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not found.");
    }

    const isCurrentCorrect = await user.isPassword(currentPassword);
    if (!isCurrentCorrect) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "Current password is incorrect.",
      );
    }

    const isSameAsNew = await user.isPassword(newPassword);
    if (isSameAsNew) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "New password must be different from your current password.",
      );
    }

    user.password = newPassword;
    await user.save();

    return new ApiResponse(
      StatusCodes.OK,
      null,
      "Password changed successfully.",
    ).send(res);
  }),

  updateLoginAlerts: asyncHandler(async (req, res) => {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "enabled must be a boolean.");
    }

    await User.findByIdAndUpdate(req.user._id, { loginAlerts: enabled });

    return new ApiResponse(
      StatusCodes.OK,
      { loginAlerts: enabled },
      `Login alerts ${enabled ? "enabled" : "disabled"}.`,
    ).send(res);
  }),
};

export default authController;
