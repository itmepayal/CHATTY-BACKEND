export const port = process.env.PORT;
export const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
export const resendApiKey = process.env.RESEND_API_KEY;
export const mongoUri = process.env.MONGO_URI;
export const mongoDbName = process.env.MONGO_DB;

export const cloudinaryName = process.env.CLOUDINARY_NAME;
export const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY;
export const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET;

export const accessToken = process.env.ACCESS_TOKEN_SECRET;
export const accessTokenExpiresIn = process.env.ACCESS_TOKEN_EXPIRES_IN;

export const refreshTokenScret = process.env.REFRESH_TOKEN_SECRET;
export const refreshTokenExpiresIn = process.env.REFRESH_TOKEN_EXPIRES_IN;

export const salt = 15;
const isProd = process.env.NODE_ENV === "production";

export const options = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? "none" : "lax",
  maxAge: 24 * 60 * 60 * 1000,
};

export const geminiApiKey = process.env.GEMINI_API_KEY;

export const swaggerEnabled = process.env.SWAGGER_ENABLED === "true";
export const swaggerServerUrl =
  process.env.SWAGGER_SERVER_URL || `http://localhost:${port}/api/v1`;

export const PASSWORD_SALT_ROUNDS = 15;

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 15;

export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

export const TWO_FA_RATE_WINDOW_MS = 15 * 60 * 1000;
export const TWO_FA_MAX_ATTEMPTS = 10;

export const CHALLENGE_TTL = "5m";

export const RECOVERY_CODE_COUNT = 8;
export const RECOVERY_CODE_BYTES = 5;
export const BCRYPT_ROUNDS_RECOVERY = 10;

export const BLOCK_CACHE_TTL_MS = 10_000;

export const MAX_NORMAL_FILE_SIZE = 10 * 1024 * 1024;

export const MAX_MEDIA_FILE_SIZE = 50 * 1024 * 1024;

export const MAX_VOICE_SECONDS = 300;
export const MAX_VIDEO_SECONDS = 60;

export const BLOCKED_EXTENSIONS = new Set([
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
]);

export const UPLOAD_DIR = "public/upload";

export const MAX_TEXT_LENGTH = 4000;

export const MAX_CIPHERTEXT_LENGTH = 24000;

export const MAX_WRAPPED_KEY_LENGTH = 2048;

export const MAX_KEY_ENTRIES = 600;

export const EDIT_WINDOW_MS = 15 * 60 * 1000;

export const MAX_PINS = 3;

export const MAX_FORWARD_TARGETS = 5;

export const MESSAGE_STATUS = Object.freeze({
  SENT: "sent",
  DELIVERED: "delivered",
  SEEN: "seen",
});

export const REPORT_REASONS = Object.freeze([
  "spam",
  "harassment",
  "inappropriate",
  "impersonation",
  "other",
]);

export const ALLOWED_DISAPPEAR_TIMERS = Object.freeze([
  0, 86400, 604800, 7776000,
]);

export const SPAM_DUP_WINDOW_MS = 30_000;

export const SPAM_DUP_MAX = 3;

export const SPAM_NEW_CHAT_WINDOW_MS = 60_000;

export const SPAM_NEW_CHAT_MAX = 10;

export const MAX_GROUP_MEMBERS = 256;

export const MAX_GROUP_TEXT = 2000;

export const GROUP_NAME_MIN = 2;
export const GROUP_NAME_MAX = 50;

export const GROUP_ROLES = Object.freeze({
  ADMIN: "admin",
  MEMBER: "member",
});

export const LIVE_DURATIONS_MIN = Object.freeze([15, 60, 480]);

export const MIN_LOCATION_UPDATE_INTERVAL_MS = 2000;

export const MAX_CALL_PARTICIPANTS = 6;

export const CALL_RING_TIMEOUT_MS = 40_000;

export const GROUP_CALL_RING_TIMEOUT_MS = 45_000;

export const CALL_TYPES = Object.freeze({
  AUDIO: "audio",
  VIDEO: "video",
});

export const CALL_STATUS = Object.freeze({
  MISSED: "missed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
});

export const LOCATION_SHARE_STATUS = Object.freeze({
  ACTIVE: "active",
  STOPPED: "stopped",
  EXPIRED: "expired",
});

export const LOCATION_EXPIRY_SWEEP_INTERVAL_MS = 30_000;

export const SOCKET_EVENTS = Object.freeze({
  GET_ONLINE_USERS: "getOnlineUsers",

  CHAT_OPEN: "chat:open",
  CHAT_CLOSE: "chat:close",

  PRIVACY_UPDATE: "privacy:update",

  TYPING: "typing",

  GROUP_TYPING: "group:typing",

  NEW_MESSAGE: "newMessage",
  MESSAGES_DELIVERED: "messagesDelivered",
  MESSAGES_SEEN: "messagesSeen",

  CONVERSATION_UPDATED: "conversationUpdated",

  DISAPPEARING_UPDATED: "disappearingUpdated",

  CHAT_ARCHIVED: "chatArchived",

  GROUP_NEW_MESSAGE: "group:newMessage",
  GROUP_CONVERSATION_UPDATED: "group:conversationUpdated",

  GROUP_CREATED: "group:created",
  GROUP_UPDATED: "group:updated",
  GROUP_DELETED: "group:deleted",
  GROUP_MEMBER_ADDED: "group:memberAdded",
  GROUP_MEMBER_REMOVED: "group:memberRemoved",
  GROUP_ROLE_CHANGED: "group:roleChanged",
  GROUP_LEFT: "group:left",

  GROUP_KEY_ROTATION_REQUIRED: "group:keyRotationRequired",
  GROUP_KEYS_NEEDED: "group:keysNeeded",

  LOCATION_UPDATE: "location:update",
  LOCATION_ENDED: "location:ended",

  GROUP_LOCATION_UPDATE: "group:location:update",
  GROUP_LOCATION_ENDED: "group:location:ended",

  CALL_INVITE: "call:invite",
  CALL_INCOMING: "call:incoming",
  CALL_ACCEPT: "call:accept",
  CALL_ACCEPTED: "call:accepted",
  CALL_REJECT: "call:reject",
  CALL_END: "call:end",
  CALL_ENDED: "call:ended",
  CALL_OFFER: "call:offer",
  CALL_ANSWER: "call:answer",
  CALL_ICE: "call:ice",
  CALL_MEDIA: "call:media",
  CALL_ANSWERED_ELSEWHERE: "call:answered-elsewhere",

  GCALL_START: "gcall:start",
  GCALL_JOIN: "gcall:join",
  GCALL_LEAVE: "gcall:leave",
  GCALL_STATUS: "gcall:status",
  GCALL_INCOMING: "gcall:incoming",
  GCALL_ENDED: "gcall:ended",
  GCALL_PEER_JOINED: "gcall:peer-joined",
  GCALL_PEER_LEFT: "gcall:peer-left",
  GCALL_JOINED_ELSEWHERE: "gcall:joined-elsewhere",
  GCALL_SIGNAL: "gcall:signal",
  GCALL_MEDIA: "gcall:media",
});

export const SOCKET_THROTTLE_MS = 400;

export const RATE_LIMITS = Object.freeze({
  SEND_MESSAGE: { windowMs: 10_000, max: 15 },
  REACT: { windowMs: 10_000, max: 30 },
  FORWARD: { windowMs: 60_000, max: 10 },
  REPORT: { windowMs: 60 * 60_000, max: 10 },
  SETTINGS: { windowMs: 60_000, max: 20 },
});

export const USER_PROFILE = Object.freeze({
  FULL_NAME_MIN: 2,
  FULL_NAME_MAX: 50,
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  BIO_MAX: 160,
  LOCATION_MAX: 60,
  PHONE_REGEX: /^[+\d][\d\s-]{7,15}$/,
  USERNAME_REGEX: /^[a-z0-9_.]{3,20}$/,
  WEBSITE_REGEX: /^https?:\/\/.+\..+/,
});

export const GENDERS = Object.freeze([
  "Female",
  "Male",
  "Other",
  "Prefer not to say",
  "",
]);

export const AI_MAX_TEXT_LENGTH = 2000;

export const AI_TONES = Object.freeze([
  "formal",
  "casual",
  "friendly",
  "professional",
  "persuasive",
]);

export const AI_ATTEMPTS_PER_MODEL = 2;
export const AI_REQUEST_TIMEOUT_MS = 15_000;
export const AI_REQUEST_DEADLINE_MS = 30_000;

export const AI_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

export const AES_GCM_IV_BYTES = 12;

export const AES_GCM_TAG_BYTES = 16;

export const BASE64_ENCODING = "base64";

export const DEFAULT_PAGE_SIZE = 30;

export const MAX_PAGE_SIZE = 100;

export const DISAPPEARING_SWEEP_INTERVAL_MS = 30_000;

export const LOCATION_EXPIRY_JOB_INTERVAL_MS = 30_000;

export const SCHEDULER_TICK_MS = 20_000;

export const CONFIRM_WORD = "DELETE";

export const VALID_THEMES = Object.freeze([
  "light",
  "dark",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
  "caramellatte",
  "abyss",
  "silk",
]);

export const EDITABLE_FIELDS = Object.freeze([
  "fullName",
  "username",
  "phone",
  "gender",
  "dob",
  "location",
  "website",
  "bio",
  "timezone",
]);

export const APPEARANCE_DB_KEY = Object.freeze({
  theme: "appearanceTheme",
  fontSize: "appearanceFontSize",
  bubbleStyle: "appearanceBubbleStyle",
  density: "appearanceDensity",
});

export const APPEARANCE_ENUMS = Object.freeze({
  theme: VALID_THEMES,
  fontSize: ["sm", "md", "lg"],
  bubbleStyle: ["rounded", "soft", "sharp"],
  density: ["comfortable", "compact"],
  timeFormat: ["12h", "24h"],
});

export const APPEARANCE_BOOL_FIELDS = Object.freeze(["showTimestamps"]);

export const PRIVACY_FIELDS = Object.freeze([
  "showOnlineStatus",
  "readReceipts",
  "typingIndicator",
]);

export const CHAT_PREF_FIELDS = Object.freeze([
  "enterToSend",
  "largeEmoji",
  "autoScroll",
]);
