import rateLimit from "express-rate-limit";

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
  10_000,
  15,
  "You are sending messages too fast. Please slow down.",
);
export const reactLimiter = make(
  10_000,
  30,
  "Too many reactions. Please slow down.",
);
export const forwardLimiter = make(
  60_000,
  10,
  "Too many forwards. Try again in a minute.",
);
export const reportLimiter = make(
  60 * 60_000,
  10,
  "Too many reports. Try again later.",
);
export const settingsLimiter = make(
  60_000,
  20,
  "Too many changes. Try again shortly.",
);
