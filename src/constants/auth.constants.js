const isProd = process.env.NODE_ENV === "production";

// Password constraints
export const PASSWORD_SALT_ROUNDS = 10;
export const salt = PASSWORD_SALT_ROUNDS;

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN = PASSWORD_MIN_LENGTH;
export const PASSWORD_MAX = PASSWORD_MAX_LENGTH;

// Email regex
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tokens
export const accessToken = process.env.ACCESS_TOKEN_SECRET;
export const accessTokenExpiresIn = process.env.ACCESS_TOKEN_EXPIRES_IN;

export const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET;
export const refreshTokenScret = refreshTokenSecret;
export const refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN;

// Cookies
export const options = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
};

export const accessCookieOptions = options;
export const cookieOptions = options;

export const refreshCookieOptions = {
  ...options,
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// Reset Token
export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const CHALLENGE_TTL = "5m";
export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODE_BYTES = 5;
export const BCRYPT_ROUNDS_RECOVERY = 10;

// Account Deletion
export const CONFIRM_WORD = "DELETE";

// Account Status
export const ACCOUNT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DEACTIVATED: "deactivated",
});

// Auth Exact Messages
export const AUTH_MESSAGES = Object.freeze({
  INVALID_CREDENTIALS: "Invalid email or password",
  ACCOUNT_SUSPENDED: "Your account has been suspended. Please contact support.",
  USER_NOT_FOUND: "User not found.",
  INVALID_SESSION: "Invalid session.",
  SESSION_REVOKED: "Session has been revoked. Please sign in again.",
  SESSION_REVOKED_OR_EXPIRED:
    "Session has been revoked or expired. Please sign in again.",
  INVALID_SESSION_OWNER: "Invalid session owner.",
  INVALID_TOKEN: "Invalid token",
  INVALID_TOKEN_FORMAT: "Invalid token format. Please sign in again.",
  SESSION_INVALIDATED: "Session invalidated. Please sign in again.",
  AUTH_REQUIRED: "Authentication required",
  NOT_AUTHENTICATED: "Not authenticated.",
  GENERIC_RESET_MSG:
    "If an account exists with this email address, you will receive instructions to reset your password.",
  RESET_SUCCESS:
    "Your password has been reset successfully. You can now log in with your new password.",
  PASSWORD_CHANGED: "Password changed successfully.",
  LOGOUT_SUCCESS: "Logged out successfully.",
  TWO_FA_REQUIRED: "Two-factor verification required.",
  TWO_FA_SUCCESS: "Two-factor verification successful.",
  TWO_FA_ENABLED: "Two-step verification enabled successfully.",
  TWO_FA_ALREADY_ENABLED: "Two-step verification is already enabled.",
  TWO_FA_NOT_ENABLED: "Two-step verification is not enabled.",
  TWO_FA_SETUP_PROMPT:
    "Scan the QR code with your authenticator app, then verify with a code.",
  RECOVERY_CODES_WARNING:
    "Save these recovery codes somewhere safe. They will not be shown again.",
  RECOVERY_CODES_REGENERATED: "Recovery codes regenerated.",
  RECOVERY_CODES_REGEN_WARNING:
    "Your previous recovery codes have been invalidated. Save these new ones.",
});
