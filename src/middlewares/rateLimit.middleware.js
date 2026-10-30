import rateLimit from "express-rate-limit";
import { RATE_LIMITS } from "../constants/constants.js";

const make = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user._id),
    handler: (req, res) => res.status(429).json({ success: false, message }),
  });

export const sendMessageLimiter = make(
  RATE_LIMITS.SEND_MESSAGE.windowMs,
  RATE_LIMITS.SEND_MESSAGE.max,
  "You are sending messages too fast. Please slow down.",
);

export const reactLimiter = make(
  RATE_LIMITS.REACT.windowMs,
  RATE_LIMITS.REACT.max,
  "Too many reactions. Please slow down.",
);

export const forwardLimiter = make(
  RATE_LIMITS.FORWARD.windowMs,
  RATE_LIMITS.FORWARD.max,
  "Too many forwards. Try again in a minute.",
);

export const reportLimiter = make(
  RATE_LIMITS.REPORT.windowMs,
  RATE_LIMITS.REPORT.max,
  "Too many reports. Try again later.",
);

export const settingsLimiter = make(
  RATE_LIMITS.SETTINGS.windowMs,
  RATE_LIMITS.SETTINGS.max,
  "Too many changes. Try again shortly.",
);
