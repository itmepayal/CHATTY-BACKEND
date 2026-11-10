import {
  createRateLimiter,
  defaultUserKeyGenerator,
} from "./rate-limit.factory.js";
import { RATE_LIMIT_CONFIG } from "../../shared/constants/rate-limit.constants.js";

export const sendMessageLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.SEND_MESSAGE.windowMs,
  max: RATE_LIMIT_CONFIG.SEND_MESSAGE.max,
  message: RATE_LIMIT_CONFIG.SEND_MESSAGE.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const reactLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.REACT.windowMs,
  max: RATE_LIMIT_CONFIG.REACT.max,
  message: RATE_LIMIT_CONFIG.REACT.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const forwardLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.FORWARD.windowMs,
  max: RATE_LIMIT_CONFIG.FORWARD.max,
  message: RATE_LIMIT_CONFIG.FORWARD.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const reportLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.REPORT.windowMs,
  max: RATE_LIMIT_CONFIG.REPORT.max,
  message: RATE_LIMIT_CONFIG.REPORT.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const settingsLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.SETTINGS.windowMs,
  max: RATE_LIMIT_CONFIG.SETTINGS.max,
  message: RATE_LIMIT_CONFIG.SETTINGS.message,
  keyGenerator: defaultUserKeyGenerator,
});

