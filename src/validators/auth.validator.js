import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import {
  EMAIL_REGEX,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from "../constants/auth.constants.js";
import { isValidResetToken } from "../utils/token-hash.js";

/**
 * Normalizes email by trimming and converting to lowercase.
 * @param {any} value
 * @returns {string}
 */
export const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

/**
 * Validates password length against minimum and maximum boundaries.
 * @param {any} value
 * @returns {boolean}
 */
export const isValidPasswordLength = (value) =>
  typeof value === "string" &&
  value.length >= PASSWORD_MIN &&
  value.length <= PASSWORD_MAX;

/**
 * Validates registration input fields.
 * @param {object} params
 * @param {string} params.fullName
 * @param {string} params.email
 * @param {string} params.password
 * @param {object} params.file
 * @throws {ApiError}
 */
export const validateRegisterInput = ({ fullName, email, password, file }) => {
  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    !email ||
    typeof password !== "string" ||
    !password
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Full name, email, and password are required.",
    );
  }

  if (!EMAIL_REGEX.test(email)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Enter a valid email address.",
    );
  }

  if (!isValidPasswordLength(password)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    );
  }

  if (!file?.path) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Avatar file is required.");
  }
};

/**
 * Validates login input credentials.
 * @param {object} params
 * @param {string} params.email
 * @param {string} params.password
 * @throws {ApiError}
 */
export const validateLoginInput = ({ email, password }) => {
  if (!email || typeof password !== "string" || !password) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Email and password are required",
    );
  }
};

/**
 * Validates email for password reset request.
 * @param {string} email
 * @throws {ApiError}
 */
export const validateForgotPasswordInput = (email) => {
  if (!email) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email is required.");
  }

  if (!EMAIL_REGEX.test(email)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Enter a valid email address.",
    );
  }
};

/**
 * Validates password reset parameters.
 * @param {object} params
 * @param {string} params.token
 * @param {string} params.password
 * @param {string} params.confirmPassword
 * @throws {ApiError}
 */
export const validateResetPasswordInput = ({
  token,
  password,
  confirmPassword,
}) => {
  if (!isValidResetToken(token)) {
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

  if (!isValidPasswordLength(password)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    );
  }
};

/**
 * Validates change password parameters.
 * @param {object} params
 * @param {string} params.currentPassword
 * @param {string} params.newPassword
 * @param {string} params.confirmPassword
 * @throws {ApiError}
 */
export const validateChangePasswordInput = ({
  currentPassword,
  newPassword,
  confirmPassword,
}) => {
  if (!currentPassword || !newPassword || !confirmPassword) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "All three password fields are required.",
    );
  }

  if (!isValidPasswordLength(newPassword)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `New password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
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
};

/**
 * Validates 2FA login verification input.
 * @param {object} params
 * @param {string} params.challengeToken
 * @param {string} params.code
 * @throws {ApiError}
 */
export const validate2FAVerifyLoginInput = ({ challengeToken, code }) => {
  if (!challengeToken || !code) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Challenge token and code are required.",
    );
  }
};

/**
 * Validates TOTP code presence.
 * @param {string} code
 * @param {string} [customMessage]
 * @throws {ApiError}
 */
export const validateTotpCodeInput = (
  code,
  customMessage = "Verification code is required.",
) => {
  if (!code) {
    throw new ApiError(StatusCodes.BAD_REQUEST, customMessage);
  }
};

/**
 * Validates login alerts enabled parameter.
 * @param {any} enabled
 * @throws {ApiError}
 */
export const validateLoginAlertsInput = (enabled) => {
  if (typeof enabled !== "boolean") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "enabled must be a boolean.");
  }
};

