import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { RATE_LIMITS } from "../../constants/constants.js";

const makeUserLimiter = ({ windowMs, max, message, keyGenerator }) =>
  rateLimit({
    windowMs,
    limit: max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator:
      keyGenerator ??
      ((req) => String(req.user?._id ?? req.user?.id ?? req.ip)),
    handler: (req, res) => res.status(429).json({ success: false, message }),
  });

export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.ip),
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message:
        "Too many requests from this IP. Please try again after 15 minutes.",
    }),
});

export const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.ip),
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      message: "Too many verification attempts. Please try again later.",
    }),
});

export const publicChatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: {
    success: false,
    message: "Too many AI requests. Please wait a minute.",
  },
});

export const toolsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?._id ?? req.user?.id;
    return userId ? String(userId) : ipKeyGenerator(req.ip);
  },
  message: {
    success: false,
    message: "Too many AI requests. Please wait a minute.",
  },
});

export const sendMessageLimiter = makeUserLimiter({
  windowMs: RATE_LIMITS.SEND_MESSAGE.windowMs,
  max: RATE_LIMITS.SEND_MESSAGE.max,
  message: "You are sending messages too fast. Please slow down.",
});

export const reactLimiter = makeUserLimiter({
  windowMs: RATE_LIMITS.REACT.windowMs,
  max: RATE_LIMITS.REACT.max,
  message: "Too many reactions. Please slow down.",
});

export const forwardLimiter = makeUserLimiter({
  windowMs: RATE_LIMITS.FORWARD.windowMs,
  max: RATE_LIMITS.FORWARD.max,
  message: "Too many forwards. Try again in a minute.",
});

export const reportLimiter = makeUserLimiter({
  windowMs: RATE_LIMITS.REPORT.windowMs,
  max: RATE_LIMITS.REPORT.max,
  message: "Too many reports. Try again later.",
});

export const settingsLimiter = makeUserLimiter({
  windowMs: RATE_LIMITS.SETTINGS.windowMs,
  max: RATE_LIMITS.SETTINGS.max,
  message: "Too many changes. Try again shortly.",
});
