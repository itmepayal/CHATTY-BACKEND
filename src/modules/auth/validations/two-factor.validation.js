import { z } from "zod";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";

export const twoFactorVerifyLoginBodySchema = z.object({
  challengeToken: z
    .string({ required_error: "Challenge token and code are required." })
    .min(1, "Challenge token and code are required."),
  code: z
    .string({ required_error: "Challenge token and code are required." })
    .min(1, "Challenge token and code are required."),
});

export const twoFactorTotpCodeBodySchema = z.object({
  code: z
    .string({ required_error: "Verification code is required." })
    .min(1, "Verification code is required."),
});

export const loginAlertsBodySchema = z.object({
  enabled: z.boolean({
    required_error: "enabled must be a boolean.",
    invalid_type_error: "enabled must be a boolean.",
  }),
});

export const validate2FAVerifyLoginInput = ({ challengeToken, code }) => {
  if (!challengeToken || !code) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Challenge token and code are required.",
    );
  }
};

export const validateTotpCodeInput = (
  code,
  customMessage = "Verification code is required.",
) => {
  if (!code) {
    throw new ApiError(StatusCodes.BAD_REQUEST, customMessage);
  }
};

export const validateLoginAlertsInput = (enabled) => {
  if (typeof enabled !== "boolean") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "enabled must be a boolean.");
  }
};
