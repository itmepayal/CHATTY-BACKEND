import {
  createRateLimiter,
  defaultIpKeyGenerator,
  defaultUserKeyGenerator,
} from "./rate-limit.factory.js";
import { RATE_LIMIT_CONFIG } from "../../constants/shared/rate-limit.constants.js";

export const publicChatLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.AI_CHAT.windowMs,
  max: RATE_LIMIT_CONFIG.AI_CHAT.max,
  message: RATE_LIMIT_CONFIG.AI_CHAT.message,
  keyGenerator: defaultIpKeyGenerator,
});

export const toolsLimiter = createRateLimiter({
  windowMs: RATE_LIMIT_CONFIG.AI_TOOLS.windowMs,
  max: RATE_LIMIT_CONFIG.AI_TOOLS.max,
  message: RATE_LIMIT_CONFIG.AI_TOOLS.message,
  keyGenerator: defaultUserKeyGenerator,
});
