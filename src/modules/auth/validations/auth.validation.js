import { z } from "zod";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import {
  EMAIL_REGEX,
  PASSWORD_MIN,
  PASSWORD_MAX,
} from "../constants/auth.constants.js";
import { isValidResetToken } from "../helpers/token-hash.js";
import { objectIdSchema } from "../../../shared/validators/object-id.validation.js";

export {
  twoFactorVerifyLoginBodySchema,
  twoFactorTotpCodeBodySchema,
  loginAlertsBodySchema,
  validate2FAVerifyLoginInput,
  validateTotpCodeInput,
  validateLoginAlertsInput,
} from "./two-factor.validation.js";

export const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const normalizeUsername = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const isValidPasswordLength = (value) =>
  typeof value === "string" &&
  value.length >= PASSWORD_MIN &&
  value.length <= PASSWORD_MAX;

export const emailSchema = z
  .string({ required_error: "Email is required." })
  .trim()
  .min(1, "Email is required.")
  .regex(EMAIL_REGEX, "Enter a valid email address.");

export const passwordSchema = z
  .string({ required_error: "Password is required." })
  .min(
    PASSWORD_MIN,
    `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
  )
  .max(
    PASSWORD_MAX,
    `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
  );

export const registerBodySchema = z.object({
  fullName: z
    .string({ required_error: "Full name is required." })
    .trim()
    .min(1, "Full name, email, and password are required."),
  email: emailSchema,
  password: passwordSchema,
});

export const loginBodySchema = z.object({
  email: z
    .string({ required_error: "Email and password are required" })
    .min(1, "Email and password are required"),
  password: z
    .string({ required_error: "Email and password are required" })
    .min(1, "Email and password are required"),
});

export const forgotPasswordBodySchema = z.object({
  email: z
    .string({ required_error: "Email is required." })
    .trim()
    .min(1, "Email is required.")
    .regex(EMAIL_REGEX, "Enter a valid email address."),
});

export const resetPasswordBodySchema = z
  .object({
    password: z
      .string({ required_error: "Both password fields are required." })
      .min(1, "Both password fields are required."),
    confirmPassword: z
      .string({ required_error: "Both password fields are required." })
      .min(1, "Both password fields are required."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((data) => isValidPasswordLength(data.password), {
    message: `Password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    path: ["password"],
  });

export const changePasswordBodySchema = z
  .object({
    currentPassword: z
      .string({ required_error: "All three password fields are required." })
      .min(1, "All three password fields are required."),
    newPassword: z
      .string({ required_error: "All three password fields are required." })
      .min(1, "All three password fields are required."),
    confirmPassword: z
      .string({ required_error: "All three password fields are required." })
      .min(1, "All three password fields are required."),
  })
  .refine((data) => isValidPasswordLength(data.newPassword), {
    message: `New password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`,
    path: ["newPassword"],
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "New password and confirmation do not match.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from your current password.",
    path: ["newPassword"],
  });

export const sessionIdParamSchema = z.object({
  sessionId: objectIdSchema,
});

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
    throw new ApiError(StatusCodes.BAD_REQUEST, "Enter a valid email address.");
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

export const validateLoginInput = ({ email, password }) => {
  if (!email || typeof password !== "string" || !password) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Email and password are required",
    );
  }
};

export const validateForgotPasswordInput = (email) => {
  if (!email) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Email is required.");
  }

  if (!EMAIL_REGEX.test(email)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Enter a valid email address.");
  }
};

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
