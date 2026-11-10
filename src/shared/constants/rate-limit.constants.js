export const TWO_FA_RATE_WINDOW_MS = 15 * 60 * 1000;
export const TWO_FA_MAX_ATTEMPTS = 10;

export const RATE_LIMIT_CONFIG = Object.freeze({
  AUTH_STRICT: Object.freeze({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message:
      "Too many requests from this IP. Please try again after 15 minutes.",
  }),
  AUTH_TWO_FA: Object.freeze({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: "Too many verification attempts. Please try again later.",
  }),
  AUTH_LOGIN: Object.freeze({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message:
      "Too many login attempts from this IP. Please try again after 15 minutes.",
  }),
  AUTH_REGISTER: Object.freeze({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message:
      "Too many accounts created from this IP. Please try again after an hour.",
  }),
  AUTH_REFRESH: Object.freeze({
    windowMs: 15 * 60 * 1000,
    max: 30,
    message: "Too many token refresh requests. Please try again later.",
  }),

  AI_CHAT: Object.freeze({
    windowMs: 60_000,
    max: 10,
    message: "Too many AI requests. Please wait a minute.",
  }),
  AI_TOOLS: Object.freeze({
    windowMs: 60_000,
    max: 20,
    message: "Too many AI requests. Please wait a minute.",
  }),

  SEND_MESSAGE: Object.freeze({
    windowMs: 10_000,
    max: 15,
    message: "You are sending messages too fast. Please slow down.",
  }),
  REACT: Object.freeze({
    windowMs: 10_000,
    max: 30,
    message: "Too many reactions. Please slow down.",
  }),
  FORWARD: Object.freeze({
    windowMs: 60_000,
    max: 10,
    message: "Too many forwards. Try again in a minute.",
  }),
  REPORT: Object.freeze({
    windowMs: 60 * 60_000,
    max: 10,
    message: "Too many reports. Try again later.",
  }),
  SETTINGS: Object.freeze({
    windowMs: 60_000,
    max: 20,
    message: "Too many changes. Try again shortly.",
  }),
});

export const SOCKET_RATE_LIMITS = Object.freeze({
  CALL_INVITE: Object.freeze({
    capacity: 5,
    refillPerSec: 5 / 30,
  }),
  CALL_ICE: Object.freeze({
    capacity: 50,
    refillPerSec: 25,
  }),
  CALL_MEDIA: Object.freeze({
    capacity: 20,
    refillPerSec: 5,
  }),
  GCALL_SIGNAL: Object.freeze({
    capacity: 100,
    refillPerSec: 50,
  }),
  GCALL_MEDIA: Object.freeze({
    capacity: 20,
    refillPerSec: 5,
  }),
  PRIVACY_UPDATE: Object.freeze({
    capacity: 5,
    refillPerSec: 5 / 60,
  }),
  TYPING: Object.freeze({
    capacity: 20,
    refillPerSec: 5,
  }),
});
