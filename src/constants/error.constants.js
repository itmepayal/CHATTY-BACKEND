/**
 * Centralized Error Constants
 */
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTHENTICATION_ERROR: "AUTHENTICATION_ERROR",
  AUTHORIZATION_ERROR: "AUTHORIZATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
});

export const COMMON_ERROR_MESSAGES = Object.freeze({
  UNAUTHORIZED: "Unauthorized request.",
  FORBIDDEN: "Forbidden: You do not have permission to perform this action.",
  NOT_FOUND: "Resource not found.",
  INVALID_ID: "Invalid ID format.",
  INTERNAL_SERVER_ERROR: "An internal server error occurred.",
  TOO_MANY_REQUESTS: "Too many requests. Please try again later.",
});
