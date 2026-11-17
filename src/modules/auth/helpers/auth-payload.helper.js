import { prefsPayload } from "../../users/utils/user-prefs.js";

const toIdList = (arr) =>
  Array.isArray(arr) ? arr.map((x) => String(x?._id ?? x)) : [];

export const buildAuthUserPayload = (user, tokens = null, extra = {}) => ({
  id: String(user._id ?? user.id),
  _id: user._id,
  fullName: user.fullName,
  username: user.username || "",
  email: user.email,
  avatar:
    user.avatar?.url || (typeof user.avatar === "string" ? user.avatar : ""),
  blockedUsers: toIdList(user.blockedUsers),
  favorites: toIdList(user.favorites),
  lockedChats: toIdList(user.lockedChats),
  appLockEnabled: Boolean(user.appLockEnabled),
  appLockTimeout: user.appLockTimeout || "immediately",
  ...prefsPayload(user),
  ...(tokens ? { token: tokens } : {}),
  ...extra,
});
