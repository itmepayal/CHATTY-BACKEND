import { z } from "zod";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import {
  ALLOWED_TONES,
  AI_LIMITS,
  AI_ERROR_MESSAGES,
} from "../constants/ai.constants.js";

export const correctBodySchema = z.object({
  text: z
    .string({ required_error: AI_ERROR_MESSAGES.TEXT_REQUIRED })
    .trim()
    .min(1, AI_ERROR_MESSAGES.TEXT_REQUIRED)
    .max(AI_LIMITS.MAX_TEXT_LENGTH, AI_ERROR_MESSAGES.TEXT_TOO_LONG),
});

export const rewriteBodySchema = z.object({
  text: z
    .string({ required_error: AI_ERROR_MESSAGES.TEXT_REQUIRED })
    .trim()
    .min(1, AI_ERROR_MESSAGES.TEXT_REQUIRED)
    .max(AI_LIMITS.MAX_TEXT_LENGTH, AI_ERROR_MESSAGES.TEXT_TOO_LONG),
  tone: z
    .string({ required_error: AI_ERROR_MESSAGES.INVALID_TONE })
    .trim()
    .toLowerCase()
    .refine((val) => ALLOWED_TONES.includes(val), {
      message: AI_ERROR_MESSAGES.INVALID_TONE,
    }),
});

export const hinglishBodySchema = z.object({
  text: z
    .string({ required_error: AI_ERROR_MESSAGES.TEXT_REQUIRED })
    .trim()
    .min(1, AI_ERROR_MESSAGES.TEXT_REQUIRED)
    .max(AI_LIMITS.MAX_TEXT_LENGTH, AI_ERROR_MESSAGES.TEXT_TOO_LONG),
});

export const chatbotMessageSchema = z.object({
  role: z.enum(["user", "assistant"], {
    errorMap: () => ({ message: AI_ERROR_MESSAGES.INVALID_ROLE }),
  }),
  content: z
    .string({ required_error: AI_ERROR_MESSAGES.MESSAGE_EMPTY })
    .trim()
    .min(1, AI_ERROR_MESSAGES.MESSAGE_EMPTY)
    .max(AI_LIMITS.MAX_MESSAGE_LENGTH, AI_ERROR_MESSAGES.MESSAGE_TOO_LONG),
});

export const chatbotBodySchema = z
  .object({
    messages: z
      .array(chatbotMessageSchema, {
        required_error: AI_ERROR_MESSAGES.MESSAGES_REQUIRED,
      })
      .min(1, AI_ERROR_MESSAGES.MESSAGES_REQUIRED)
      .max(
        AI_LIMITS.MAX_CHAT_MESSAGES,
        AI_ERROR_MESSAGES.MAX_MESSAGES_EXCEEDED,
      ),
  })
  .refine(
    (data) => {
      const lastMsg = data.messages[data.messages.length - 1];
      return lastMsg && lastMsg.role === "user";
    },
    {
      message: AI_ERROR_MESSAGES.LAST_MESSAGE_USER,
      path: ["messages"],
    },
  );

// --- Standard Middleware Handlers ---

/**
 * Validates request body for the /correct endpoint.
 */
export const validateCorrectBody = (req, _res, next) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_REQUIRED,
    );
  }
  if (text.trim().length > AI_LIMITS.MAX_TEXT_LENGTH) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_TOO_LONG,
    );
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
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_REQUIRED,
    );
  }
  if (text.trim().length > AI_LIMITS.MAX_TEXT_LENGTH) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_TOO_LONG,
    );
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
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_REQUIRED,
    );
  }
  if (text.trim().length > AI_LIMITS.MAX_TEXT_LENGTH) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.TEXT_TOO_LONG,
    );
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
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.MESSAGES_REQUIRED,
    );
  }

  if (messages.length > AI_LIMITS.MAX_CHAT_MESSAGES) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      AI_ERROR_MESSAGES.MAX_MESSAGES_EXCEEDED,
    );
  }

  for (const m of messages) {
    if (!m || typeof m !== "object") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Each message must be an object.",
      );
    }
    if (m.role !== "user" && m.role !== "assistant") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        AI_ERROR_MESSAGES.INVALID_ROLE,
      );
    }
    if (typeof m.content !== "string" || !m.content.trim()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        AI_ERROR_MESSAGES.MESSAGE_EMPTY,
      );
    }
    if (m.content.trim().length > AI_LIMITS.MAX_MESSAGE_LENGTH) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        AI_ERROR_MESSAGES.MESSAGE_TOO_LONG,
      );
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
