/**
 * AI Module Constants
 * Centralizes allowed tones, model generation parameters, payload limits,
 * success messages, error messages, and feature identifiers.
 */

export const ALLOWED_TONES = Object.freeze([
  "formal",
  "casual",
  "friendly",
  "professional",
  "persuasive",
  "humorous",
  "concise",
]);

export const AI_GENERATION_CONFIG = Object.freeze({
  CHATBOT: {
    temperature: 0.5,
    maxOutputTokens: 1500,
  },
  DEFAULT: {
    temperature: 0.3,
    maxOutputTokens: 4000,
  },
});

export const AI_LIMITS = Object.freeze({
  MAX_TEXT_LENGTH: 2000,
  MAX_CHAT_MESSAGES: 10,
  MAX_MESSAGE_LENGTH: 400,
});

export const AI_FEATURES = Object.freeze({
  CORRECT: "correct",
  REWRITE: "rewrite",
  HINGLISH: "hinglish",
  CHATBOT: "chatbot",
});

export const AI_LABELS = Object.freeze({
  REWRITE: "rewrite result",
  TRANSLATION: "translation",
  CHATBOT: "chatbot reply",
});

export const AI_SUCCESS_MESSAGES = Object.freeze({
  CORRECT: "English corrected successfully",
  REWRITE: "Text rewritten successfully",
  HINGLISH: "Hinglish translated successfully",
  CHATBOT: "Reply generated successfully",
});

export const AI_ERROR_MESSAGES = Object.freeze({
  TEXT_REQUIRED: "Text is required.",
  TEXT_TOO_LONG: `Text must be at most ${AI_LIMITS.MAX_TEXT_LENGTH} characters.`,
  INVALID_TONE: `Tone must be one of: ${ALLOWED_TONES.join(", ")}.`,
  MESSAGES_REQUIRED: "Send at least one user message.",
  MESSAGES_ARRAY: "Messages must be an array.",
  LAST_MESSAGE_USER: "Send at least one user message.",
  INVALID_ROLE: "Message role must be either 'user' or 'assistant'.",
  MESSAGE_EMPTY: "Message content cannot be empty.",
  MESSAGE_TOO_LONG: `Message content must be at most ${AI_LIMITS.MAX_MESSAGE_LENGTH} characters.`,
  MAX_MESSAGES_EXCEEDED: `Chat history can contain at most ${AI_LIMITS.MAX_CHAT_MESSAGES} messages.`,
  SERVICE_UNCONFIGURED: "AI service is not configured. Please set GEMINI_API_KEY in your environment.",
  QUOTA_REACHED: "AI quota reached. Please try again in a minute.",
  BUSY: "AI is busy right now. Please try again in a few seconds.",
  BAD_GATEWAY: "AI service error, please try again.",
  INVALID_GRAMMAR: "AI service returned an invalid grammar response.",
});
