const toIdList = (arr) =>
  Array.isArray(arr) ? arr.map((x) => String(x?._id ?? x)) : [];

const formatUser = (user) => {
  if (!user) return null;
  const u = typeof user.toObject === "function" ? user.toObject() : user;

  return {
    id: String(u._id),
    email: u.email,
    fullName: u.fullName,
    avatar: u.avatar?.url || "",
    username: u.username,
    phone: u.phone,
    gender: u.gender,
    dob: u.dob,
    location: u.location,
    website: u.website,
    bio: u.bio,
    timezone: u.timezone,
    lastSeen: u.lastSeen,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    blockedUsers: toIdList(u.blockedUsers),
    favorites: toIdList(u.favorites),
    showOnlineStatus: u.showOnlineStatus !== false,
    readReceipts: u.readReceipts !== false,
    typingIndicator: u.typingIndicator !== false,
    enterToSend: u.enterToSend !== false,
    largeEmoji: u.largeEmoji !== false,
    autoScroll: u.autoScroll !== false,
    appearanceTheme: u.appearanceTheme ?? "light",
    appearanceFontSize: u.appearanceFontSize ?? "md",
    appearanceBubbleStyle: u.appearanceBubbleStyle ?? "rounded",
    appearanceDensity: u.appearanceDensity ?? "comfortable",
    appearanceTimestamps: u.appearanceTimestamps !== false,
    appearanceTimeFormat: u.appearanceTimeFormat ?? "12h",
  };
};

export default formatUser;
