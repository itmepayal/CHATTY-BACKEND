import User from "../models/users.model.js";

export const groupRoom = (groupId) => `group:${groupId}`;

export const onlineUsers = new Map(); // userId (string) -> Set of socket.ids (string)

export const DEFAULT_PRIVACY = {
  showOnlineStatus: true,
  onlineStatusVisibility: "everyone",
  readReceipts: true,
  typingIndicator: true,
  lastSeenVisibility: "contacts",
  profilePhotoVisibility: "everyone",
  aboutVisibility: "contacts",
  groupAddPermission: "contacts",
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
    lastSeenVisibility: p.lastSeenVisibility ?? "contacts",
    profilePhotoVisibility: p.profilePhotoVisibility ?? "everyone",
    aboutVisibility: p.aboutVisibility ?? "contacts",
    groupAddPermission: p.groupAddPermission ?? "contacts",
  };
};

export const getPrivacy = (userId) =>
  privacyByUser.get(String(userId)) || DEFAULT_PRIVACY;

export const loadPrivacy = async (userId) => {
  try {
    const u = await User.findById(userId)
      .select(
        "showOnlineStatus onlineStatusVisibility readReceipts typingIndicator lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission",
      )
      .lean();

    if (u) privacyByUser.set(String(userId), cleanPrivacy(u));
  } catch (e) {
    console.error("[socket] loadPrivacy failed:", e?.message || e);
  }
};

export const isUserOnline = (userId) =>
  (onlineUsers.get(userId?.toString())?.size || 0) > 0;
