import rateLimit, { ipKeyGenerator } from "express-rate-limit";

export const LIMIT_MESSAGE = {
  success: false,
  message: "Too many AI requests. Please wait a minute.",
};

export const publicChatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: LIMIT_MESSAGE,
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
  message: LIMIT_MESSAGE,
});
