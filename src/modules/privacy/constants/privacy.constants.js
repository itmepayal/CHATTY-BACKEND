export const VIS = Object.freeze(["everyone", "contacts", "nobody"]);
export const VISIBILITY_OPTIONS = VIS;

export const PRIVACY_BOOL_FIELDS = Object.freeze([
  "showOnlineStatus",
  "readReceipts",
  "typingIndicator",
]);

export const PRIVACY_VIS_FIELDS = Object.freeze([
  "lastSeenVisibility",
  "onlineStatusVisibility",
  "profilePhotoVisibility",
  "aboutVisibility",
  "groupAddPermission",
  "whoCanAddMeToGroups",
]);

export const PRIVACY_FIELDS = Object.freeze([
  ...PRIVACY_BOOL_FIELDS,
  ...PRIVACY_VIS_FIELDS,
]);

export const CHAT_PREF_FIELDS = Object.freeze([
  "enterToSend",
  "largeEmoji",
  "autoScroll",
  "enterIsSend",
]);

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

export const CANONICAL_APPEARANCE_KEYS = Object.freeze({
  theme: "theme",
  fontSize: "fontSize",
  bubbleStyle: "bubbleStyle",
  messageBubbleStyle: "bubbleStyle",
  bubble: "bubbleStyle",
  density: "density",
  spacing: "density",
  messageSpacing: "density",
  compactMode: "density",
  showTimestamps: "showTimestamps",
  timestamps: "showTimestamps",
  timeFormat: "timeFormat",
});

export const APPEARANCE_DB_KEY = Object.freeze({
  theme: "appearanceTheme",
  fontSize: "appearanceFontSize",
  bubbleStyle: "appearanceBubbleStyle",
  messageBubbleStyle: "appearanceBubbleStyle",
  bubble: "appearanceBubbleStyle",
  density: "appearanceDensity",
  spacing: "appearanceDensity",
  messageSpacing: "appearanceDensity",
  compactMode: "appearanceDensity",
  showTimestamps: "appearanceTimestamps",
  timestamps: "appearanceTimestamps",
  timeFormat: "appearanceTimeFormat",
});

export const APPEARANCE_ENUMS = Object.freeze({
  theme: VALID_THEMES,
  fontSize: Object.freeze(["sm", "md", "lg", "small", "medium", "large"]),
  bubbleStyle: Object.freeze(["rounded", "soft", "sharp", "round"]),
  messageBubbleStyle: Object.freeze([
    "rounded",
    "soft",
    "sharp",
    "round",
    "modern",
    "classic",
    "minimal",
  ]),
  bubble: Object.freeze(["round", "soft", "sharp", "rounded"]),
  density: Object.freeze(["comfortable", "compact", "cozy"]),
  spacing: Object.freeze(["comfortable", "compact", "cozy"]),
  messageSpacing: Object.freeze(["comfortable", "compact", "cozy"]),
  timeFormat: Object.freeze(["12h", "24h", "12-hour", "24-hour"]),
  chatBackground: Object.freeze([
    "default",
    "subtle-dots",
    "doodle",
    "geometric",
    "gradient",
    "solid-dark",
    "solid-light",
  ]),
});

export const APPEARANCE_BOOL_FIELDS = Object.freeze([
  "showTimestamps",
  "timestamps",
  "compactMode",
]);

export const EDITABLE_FIELDS = Object.freeze([
  "bio",
  "phone",
  "website",
  "location",
  "dateOfBirth",
  "gender",
  "dob",
]);

export const PRIVACY_PROJECTION_FIELDS =
  "showOnlineStatus onlineStatusVisibility readReceipts typingIndicator lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission";

export const CHAT_PREF_PROJECTION_FIELDS =
  "enterToSend largeEmoji autoScroll";

export const APPEARANCE_PROJECTION_FIELDS =
  "theme fontSize bubbleStyle density showTimestamps timeFormat appearanceTheme appearanceFontSize appearanceBubbleStyle appearanceDensity appearanceTimestamps appearanceTimeFormat";
