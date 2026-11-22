import {
  createRateLimiter,
  defaultUserKeyGenerator,
} from "./rate-limit.factory.js";
import { RATE_LIMIT_CONFIG } from "../../shared/constants/rate-limit.constants.js";

export const callHistoryLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.CALL_HISTORY.windowMs,
  max: RATE_LIMIT_CONFIG.CALL_HISTORY.max,
  message: RATE_LIMIT_CONFIG.CALL_HISTORY.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const callIceServersLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.CALL_ICE.windowMs,
  max: RATE_LIMIT_CONFIG.CALL_ICE.max,
  message: RATE_LIMIT_CONFIG.CALL_ICE.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const callDeleteLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.CALL_DELETE.windowMs,
  max: RATE_LIMIT_CONFIG.CALL_DELETE.max,
  message: RATE_LIMIT_CONFIG.CALL_DELETE.message,
  keyGenerator: defaultUserKeyGenerator,
});
