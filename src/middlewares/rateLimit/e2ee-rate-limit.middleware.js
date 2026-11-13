import {
  createRateLimiter,
  defaultUserKeyGenerator,
} from "./rate-limit.factory.js";
import { RATE_LIMIT_CONFIG } from "../../shared/constants/rate-limit.constants.js";

export const e2eeRegisterLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.E2EE_REGISTER.windowMs,
  max: RATE_LIMIT_CONFIG.E2EE_REGISTER.max,
  message: RATE_LIMIT_CONFIG.E2EE_REGISTER.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const e2eeBackupLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.E2EE_BACKUP.windowMs,
  max: RATE_LIMIT_CONFIG.E2EE_BACKUP.max,
  message: RATE_LIMIT_CONFIG.E2EE_BACKUP.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const e2eeResetLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.E2EE_RESET.windowMs,
  max: RATE_LIMIT_CONFIG.E2EE_RESET.max,
  message: RATE_LIMIT_CONFIG.E2EE_RESET.message,
  keyGenerator: defaultUserKeyGenerator,
});

export const e2eePublicKeysLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.E2EE_PUBLIC_KEYS.windowMs,
  max: RATE_LIMIT_CONFIG.E2EE_PUBLIC_KEYS.max,
  message: RATE_LIMIT_CONFIG.E2EE_PUBLIC_KEYS.message,
  keyGenerator: defaultUserKeyGenerator,
});
