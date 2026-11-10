export const VIS = Object.freeze(["everyone", "contacts", "nobody"]);
export const VISIBILITY_OPTIONS = VIS;

export const PRIVACY_FIELDS = Object.freeze([
  "lastSeenVisibility",
  "profilePhotoVisibility",
  "aboutVisibility",
  "readReceipts",
  "typingIndicator",
  "onlineStatusVisibility",
]);

export const PRIVACY_VIS_FIELDS = Object.freeze([
  "lastSeenVisibility",
  "profilePhotoVisibility",
  "aboutVisibility",
  "onlineStatusVisibility",
]);

export const CHAT_PREF_FIELDS = Object.freeze([
  "enterIsSend",
  "mediaAutoDownload",
  "soundEnabled",
  "linkPreviews",
]);

export const APPEARANCE_DB_KEY = Object.freeze({
  theme: "theme",
  fontSize: "fontSize",
  compactMode: "compactMode",
  messageBubbleStyle: "messageBubbleStyle",
  chatBackground: "chatBackground",
  showTimestamps: "showTimestamps",
});

export const APPEARANCE_ENUMS = Object.freeze({
  fontSize: Object.freeze(["small", "medium", "large"]),
  messageBubbleStyle: Object.freeze(["modern", "classic", "minimal"]),
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

export const APPEARANCE_BOOL_FIELDS = Object.freeze(["showTimestamps"]);

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
]);

export const EDITABLE_FIELDS = Object.freeze([
  "bio",
  "phone",
  "website",
  "location",
  "dateOfBirth",
  "gender",
]);

export const PRIVACY_PROJECTION_FIELDS =
  "showOnlineStatus onlineStatusVisibility readReceipts typingIndicator lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission";

export const CHAT_PREF_PROJECTION_FIELDS =
  "enterIsSend mediaAutoDownload linkPreviews archiveChats keepChatsArchived wallPaper defaultDisappearingDuration chatBackup";

export const APPEARANCE_PROJECTION_FIELDS = "theme fontSize language";
