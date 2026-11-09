import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import {
  ALLOWED_TONES,
  AI_LIMITS,
  AI_ERROR_MESSAGES,
} from "../constants/ai.constants.js";

/**
 * Validates request body for the /correct endpoint.
 */
export const validateCorrectBody = (req, _res, next) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.TEXT_REQUIRED);
  }
  if (text.trim().length > AI_LIMITS.MAX_TEXT_LENGTH) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.TEXT_TOO_LONG);
  }
  req.body.text = text.trim();
  next();
};

/**
 * Validates request body for the /rewrite endpoint.
 */
export const validateRewriteBody = (req, _res, next) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.TEXT_REQUIRED);
  }
  if (text.trim().length > AI_LIMITS.MAX_TEXT_LENGTH) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.TEXT_TOO_LONG);
  }

  const rawTone = req.body?.tone;
  if (typeof rawTone !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.INVALID_TONE);
  }
  const cleanTone = rawTone.trim().toLowerCase();
  if (!ALLOWED_TONES.includes(cleanTone)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.INVALID_TONE);
  }

  req.body.text = text.trim();
  req.body.tone = cleanTone;
  next();
};

/**
 * Validates request body for the /hinglish endpoint.
 */
export const validateHinglishBody = (req, _res, next) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.TEXT_REQUIRED);
  }
  if (text.trim().length > AI_LIMITS.MAX_TEXT_LENGTH) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.TEXT_TOO_LONG);
  }
  req.body.text = text.trim();
  next();
};

/**
 * Validates request body for the /chatbot endpoint.
 */
export const validateChatbotBody = (req, _res, next) => {
  const messages = req.body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.MESSAGES_REQUIRED);
  }

  if (messages.length > AI_LIMITS.MAX_CHAT_MESSAGES) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.MAX_MESSAGES_EXCEEDED,
    );
  }

  for (const m of messages) {
    if (!m || typeof m !== "object") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Each message must be an object.");
    }
    if (m.role !== "user" && m.role !== "assistant") {
      throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.INVALID_ROLE);
    }
    if (typeof m.content !== "string" || !m.content.trim()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.MESSAGE_EMPTY);
    }
    if (m.content.trim().length > AI_LIMITS.MAX_MESSAGE_LENGTH) {
      throw new ApiError(StatusCodes.BAD_REQUEST, AI_ERROR_MESSAGES.MESSAGE_TOO_LONG);
    }
  }

  const lastMessage = messages[messages.length - 1];
  if (lastMessage.role !== "user") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.LAST_MESSAGE_USER,
    );
  }

  next();
};
