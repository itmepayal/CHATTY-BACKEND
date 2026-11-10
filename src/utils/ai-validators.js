import { StatusCodes } from "http-status-codes";
import ApiError from "./api-error.js";
import {
  ALLOWED_TONES,
  AI_LIMITS,
  AI_ERROR_MESSAGES,
} from "../constants/ai/ai.constants.js";

export const sanitizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

export const validateText = (text) => {
  const trimmed = sanitizeText(text);

  if (!trimmed) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_REQUIRED,
    );
  }

  if (trimmed.length > AI_LIMITS.MAX_TEXT_LENGTH) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_TOO_LONG,
    );
  }

  return trimmed;
};

export const validateTone = (tone) => {
  if (typeof tone !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.INVALID_TONE);
  }

  const cleanTone = tone.trim().toLowerCase();
  if (!ALLOWED_TONES.includes(cleanTone)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.INVALID_TONE);
  }

  return cleanTone;
};

export const validateGeneratedText = (value, label) => {
  const text = sanitizeText(value);
  if (!text) {
    throw new ApiError(
      StatusCodes.BAD_GATEWAY,
      `AI service returned an empty ${label}.`,
    );
  }
  return text;
};
