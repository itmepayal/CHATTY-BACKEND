import User from "../../modules/users/models/users.model.js";

export const groupRoom = (groupId) => `group:${groupId}`;

export const onlineUsers = new Map();

export const DEFAULT_PRIVACY = {
  showOnlineStatus: true,
  onlineStatusVisibility: "everyone",
  readReceipts: true,
  typingIndicator: true,
  silenceUnknownCallers: false,
  appLockEnabled: false,
  appLockTimeout: "immediately",
  lastSeenVisibility: "everyone",
  profilePhotoVisibility: "everyone",
  aboutVisibility: "everyone",
  statusVisibility: "contacts",
  groupAddPermission: "everyone",
  lastSeenExceptions: [],
  profilePhotoExceptions: [],
  aboutExceptions: [],
  statusExceptions: [],
  statusIncluded: [],
  groupAddExceptions: [],
  lockedChats: [],
};

export const privacyByUser = new Map();

export const cleanPrivacy = (p = {}) => {
  const onlineStatusVisibility =
    p.onlineStatusVisibility ??
    (p.showOnlineStatus === false ? "nobody" : "everyone");
  return {
    showOnlineStatus: onlineStatusVisibility !== "nobody",
    onlineStatusVisibility,
    readReceipts: p.readReceipts !== false,
    typingIndicator: p.typingIndicator !== false,
    silenceUnknownCallers: Boolean(p.silenceUnknownCallers),
    appLockEnabled: Boolean(p.appLockEnabled),
    appLockTimeout: p.appLockTimeout || "immediately",
    lastSeenVisibility: p.lastSeenVisibility ?? "everyone",
    profilePhotoVisibility: p.profilePhotoVisibility ?? "everyone",
    aboutVisibility: p.aboutVisibility ?? "everyone",
    statusVisibility: p.statusVisibility ?? "contacts",
    groupAddPermission: p.groupAddPermission ?? "everyone",
    lastSeenExceptions: (p.lastSeenExceptions || []).map(String),
    profilePhotoExceptions: (p.profilePhotoExceptions || []).map(String),
    aboutExceptions: (p.aboutExceptions || []).map(String),
    statusExceptions: (p.statusExceptions || []).map(String),
    statusIncluded: (p.statusIncluded || []).map(String),
    groupAddExceptions: (p.groupAddExceptions || []).map(String),
    lockedChats: (p.lockedChats || []).map(String),
  };
};

export const getPrivacy = (userId) =>
  privacyByUser.get(String(userId)) || DEFAULT_PRIVACY;

export const getOrFetchPrivacy = async (userId) => {
  const idStr = String(userId);
  if (privacyByUser.has(idStr)) {
    return privacyByUser.get(idStr);
  }
  await loadPrivacy(idStr);
  return getPrivacy(idStr);
};

export const loadPrivacy = async (userId) => {
  try {
    const u = await User.findById(userId)
      .select(
        "showOnlineStatus onlineStatusVisibility readReceipts typingIndicator lastSeenVisibility profilePhotoVisibility aboutVisibility statusVisibility groupAddPermission lastSeenExceptions profilePhotoExceptions aboutExceptions statusExceptions statusIncluded groupAddExceptions silenceUnknownCallers appLockEnabled appLockTimeout lockedChats",
      )
      .lean();

    if (u) privacyByUser.set(String(userId), cleanPrivacy(u));
  } catch (e) {
    console.error("[socket] loadPrivacy failed:", e?.message || e);
  }
};

export const isUserOnline = (userId) =>
  (onlineUsers.get(userId?.toString())?.size || 0) > 0;
