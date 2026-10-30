import ApiError from "./api-error.js";
import { StatusCodes } from "http-status-codes";
import {
  TWO_FA_RATE_WINDOW_MS,
  TWO_FA_MAX_ATTEMPTS,
} from "../constants/constants.js";

const failedAttempts = new Map();
const WINDOW_MS = TWO_FA_RATE_WINDOW_MS;
const MAX_ATTEMPTS = TWO_FA_MAX_ATTEMPTS;

export function checkRateLimit(userId) {
  const now = Date.now();
  const key = String(userId);
  const rec = failedAttempts.get(key);
  if (!rec) return;
  if (now > rec.resetAt) {
    failedAttempts.delete(key);
    return;
  }
  if (rec.count >= MAX_ATTEMPTS) {
    const wait = Math.ceil((rec.resetAt - now) / 60000);
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      `Too many attempts. Try again in ${wait} minute${wait !== 1 ? "s" : ""}.`,
    );
  }
}

export function recordFail(userId) {
  const now = Date.now();
  const key = String(userId);
  let rec = failedAttempts.get(key);
  if (!rec || now > rec.resetAt) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
  }
  rec.count += 1;
  failedAttempts.set(key, rec);
}

export function clearFail(userId) {
  failedAttempts.delete(String(userId));
}
