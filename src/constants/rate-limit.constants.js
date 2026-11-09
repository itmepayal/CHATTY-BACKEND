export const TWO_FA_RATE_WINDOW_MS = 15 * 60 * 1000;
export const TWO_FA_MAX_ATTEMPTS = 10;

export const RATE_LIMIT_CONFIG = Object.freeze({
  AUTH_STRICT: {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message:
      "Too many requests from this IP. Please try again after 15 minutes.",
  },
  AUTH_TWO_FA: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many verification attempts. Please try again later.",
  },
  AUTH_LOGIN: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message:
      "Too many login attempts from this IP. Please try again after 15 minutes.",
  },
  AUTH_REGISTER: {
    windowMs: 60 * 60 * 1000,
    max: 5,
    message:
      "Too many accounts created from this IP. Please try again after an hour.",
  },
  AUTH_REFRESH: {
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "Too many token refresh requests. Please try again later.",
  },

  AI_CHAT: {
    windowMs: 60_000,
    max: 10,
    message: "Too many AI requests. Please wait a minute.",
  },
  AI_TOOLS: {
    windowMs: 60_000,
    max: 20,
    message: "Too many AI requests. Please wait a minute.",
  },

  SEND_MESSAGE: {
    windowMs: 10_000,
    max: 15,
    message: "You are sending messages too fast. Please slow down.",
  },
  REACT: {
    windowMs: 10_000,
    max: 30,
    message: "Too many reactions. Please slow down.",
  },
  FORWARD: {
    windowMs: 60_000,
    max: 10,
    message: "Too many forwards. Try again in a minute.",
  },
  REPORT: {
    windowMs: 60 * 60_000,
    max: 10,
    message: "Too many reports. Try again later.",
  },
  SETTINGS: {
    windowMs: 60_000,
    max: 20,
    message: "Too many changes. Try again shortly.",
  },
});

export const SOCKET_RATE_LIMITS = Object.freeze({
  CALL_INVITE: {
    capacity: 5,
    refillPerSec: 5 / 30,
  },
  PRIVACY_UPDATE: {
    capacity: 5,
    refillPerSec: 5 / 60,
  },
  TYPING: {
    capacity: 20,
    refillPerSec: 5,
  },
});
