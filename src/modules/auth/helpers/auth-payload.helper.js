import { prefsPayload } from "../../users/utils/user-prefs.js";

export const buildAuthUserPayload = (user, tokens = null, extra = {}) => ({
  id: user._id,
  fullName: user.fullName,
  email: user.email,
  avatar: user.avatar?.url || user.avatar,
  ...prefsPayload(user),
  ...(tokens ? { token: tokens } : {}),
  ...extra,
});
