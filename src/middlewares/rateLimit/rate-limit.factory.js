import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { StatusCodes } from "http-status-codes";

export const defaultIpKeyGenerator = (req) =>
  ipKeyGenerator(req.ip || "127.0.0.1");

export const defaultUserKeyGenerator = (req) => {
  const userId = req.user?._id ?? req.user?.id;
  return userId ? String(userId) : ipKeyGenerator(req.ip || "127.0.0.1");
};

export function createRateLimiter({
  windowMs,
  max,
  message,
  keyGenerator = defaultIpKeyGenerator,
  skipSuccessfulRequests = false,
  skipFailedRequests = false,
}) {
  return rateLimit({
    windowMs,
    limit: max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator,
    skipSuccessfulRequests,
    skipFailedRequests,
    handler: (req, res, _next, options) => {
      const msg =
        typeof options.message === "string"
          ? options.message
          : options.message?.message || message;

      if (!res.getHeader("Retry-After")) {
        const resetSeconds = Math.ceil(windowMs / 1000);
        res.setHeader("Retry-After", resetSeconds.toString());
      }

      res.status(StatusCodes.TOO_MANY_REQUESTS).json({
        success: false,
        message: msg,
      });
    },
  });
}
