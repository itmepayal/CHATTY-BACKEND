import { StatusCodes } from "http-status-codes";
import ApiError from "./api-error.js";
import { AI_MAX_TEXT_LENGTH, AI_TONES } from "../constants/constants.js";

export const sanitizeText = (value) =>
  typeof value === "string" ? value.trim() : "";

export const validateText = (text) => {
  const trimmed = sanitizeText(text);

  if (!trimmed) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Text is required.");
  }

  if (trimmed.length > AI_MAX_TEXT_LENGTH) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Text must be at most ${AI_MAX_TEXT_LENGTH} characters.`,
    );
  }

  return trimmed;
};

export const validateTone = (tone) => {
  if (!AI_TONES.includes(tone)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Tone must be one of: ${AI_TONES.join(", ")}.`,
    );
  }
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
