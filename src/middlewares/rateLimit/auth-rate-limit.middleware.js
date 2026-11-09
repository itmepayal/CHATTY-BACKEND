import { createRateLimiter } from "./rate-limit.factory.js";
import { RATE_LIMIT_CONFIG } from "../../constants/rate-limit.constants.js";

export const strictLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.AUTH_STRICT.windowMs,
  max: RATE_LIMIT_CONFIG.AUTH_STRICT.max,
  message: RATE_LIMIT_CONFIG.AUTH_STRICT.message,
});

export const twoFaLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.AUTH_TWO_FA.windowMs,
  max: RATE_LIMIT_CONFIG.AUTH_TWO_FA.max,
  message: RATE_LIMIT_CONFIG.AUTH_TWO_FA.message,
});

export const loginRateLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.AUTH_LOGIN.windowMs,
  max: RATE_LIMIT_CONFIG.AUTH_LOGIN.max,
  message: RATE_LIMIT_CONFIG.AUTH_LOGIN.message,
});

export const registerRateLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.AUTH_REGISTER.windowMs,
  max: RATE_LIMIT_CONFIG.AUTH_REGISTER.max,
  message: RATE_LIMIT_CONFIG.AUTH_REGISTER.message,
});

export const refreshRateLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.AUTH_REFRESH.windowMs,
  max: RATE_LIMIT_CONFIG.AUTH_REFRESH.max,
  message: RATE_LIMIT_CONFIG.AUTH_REFRESH.message,
});
