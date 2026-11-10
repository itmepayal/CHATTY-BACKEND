// Encryption & Payload Constraints
export const MAX_TEXT_LENGTH = 4000;
export const MAX_CIPHERTEXT_LENGTH = 24000;
export const MAX_WRAPPED_KEY_LENGTH = 2048;
export const MAX_KEY_ENTRIES = 600;
export const AES_GCM_IV_BYTES = 12;
export const AES_GCM_TAG_BYTES = 16;
export const BASE64_ENCODING = "base64";

// Edit Window & Feature Limits
export const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_PINS = 3;
export const MAX_FORWARD_TARGETS = 5;

// Attachments & File Uploads
export const MAX_NORMAL_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_MEDIA_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_VOICE_SECONDS = 300; // 5 minutes
export const MAX_VIDEO_SECONDS = 60; // 1 minute
export const UPLOAD_DIR = "public/upload";
export const BLOCKED_EXTENSIONS = Object.freeze(
  new Set([
    ".exe",
    ".bat",
    ".cmd",
    ".sh",
    ".msi",
    ".com",
    ".scr",
    ".js",
    ".vbs",
    ".jar",
    ".apk",
    ".dmg",
    ".php",
    ".pif",
    ".application",
    ".gadget",
  ]),
);

// Delivery & State Enums
export const MESSAGE_STATUS = Object.freeze({
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
});

export const REPORT_REASONS = Object.freeze([
  "spam",
  "harassment",
  "inappropriate_content",
  "hate_speech",
  "other",
]);

// Ephemeral Messages & Auto-Delete Timers (in seconds: 0 = disabled, 24h, 7d, 90d)
export const ALLOWED_DISAPPEAR_TIMERS = Object.freeze([
  0, 86400, 604800, 7776000,
]);

// Anti-Spam Rate Control
export const SPAM_DUP_WINDOW_MS = 30_000;
export const SPAM_DUP_MAX = 3;
export const SPAM_NEW_CHAT_WINDOW_MS = 60_000;
export const SPAM_NEW_CHAT_MAX = 10;

// Live Location Sharing
export const LIVE_DURATIONS_MIN = Object.freeze([15, 60, 480]);
export const MIN_LOCATION_UPDATE_INTERVAL_MS = 2000;
export const LOCATION_SHARE_STATUS = Object.freeze({
  ACTIVE: "active",
  STOPPED: "stopped",
  EXPIRED: "expired",
});

// Schedulers, Background Sweeps, and Throttling
export const LOCATION_EXPIRY_SWEEP_INTERVAL_MS = 30_000;
export const LOCATION_EXPIRY_JOB_INTERVAL_MS = 30_000;
export const DISAPPEARING_SWEEP_INTERVAL_MS = 30_000;
export const SCHEDULER_TICK_MS = 20_000;
export const SOCKET_THROTTLE_MS = 400;
export const BLOCK_CACHE_TTL_MS = 10_000;
export const CALL_RING_TIMEOUT_MS = 40_000;

// Pagination
export const DEFAULT_PAGE_SIZE = 30;
export const MAX_PAGE_SIZE = 100;
