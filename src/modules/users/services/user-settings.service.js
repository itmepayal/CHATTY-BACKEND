import { StatusCodes } from "http-status-codes";
import mongoose from "mongoose";
import * as userRepository from "../repositories/user.repository.js";
import * as groupRepository from "../../groups/repositories/group.repository.js";
import ApiError from "../../../shared/errors/api-error.js";
import { assertBooleanFields } from "../../../shared/utils/validators.js";
import {
  PRIVACY_FIELDS,
  PRIVACY_BOOL_FIELDS,
  PRIVACY_VIS_FIELDS,
  PRIVACY_ARRAY_FIELDS,
  PRIVACY_MISC_FIELDS,
  CHAT_PREF_FIELDS,
  APPEARANCE_ENUMS,
  APPEARANCE_BOOL_FIELDS,
  CANONICAL_APPEARANCE_KEYS,
  APPEARANCE_DB_KEY,
  VIS,
  ONLINE_VIS,
  STATUS_VIS,
  PRIVACY_PROJECTION_FIELDS as PRIVACY_SELECT,
} from "../../privacy/constants/privacy.constants.js";
import { refreshPrivacy } from "../../../infrastructure/socket/socket.js";
import {
  verifyUnlockToken,
  verifyPinHash,
} from "../utils/lock-token.util.js";

const MAX_LOCKED_CHATS = 100;

const toStrList = (arr) => (Array.isArray(arr) ? arr.map(String) : []);

const formatPrivacy = (u) => {
  const onlineStatusVisibility =
    u.onlineStatusVisibility ??
    (u.showOnlineStatus === false ? "nobody" : "everyone");
  const hasVerifier = Boolean(u.appLockPinHash || u.hasPinVerifier);
  const appLockEnabled = Boolean(u.appLockEnabled && (hasVerifier || u.appLockPinHash === undefined));
  return {
    showOnlineStatus: onlineStatusVisibility !== "nobody",
    readReceipts: u.readReceipts !== false,
    typingIndicator: u.typingIndicator !== false,
    silenceUnknownCallers: Boolean(u.silenceUnknownCallers),
    appLockEnabled,
    appLockTimeout: u.appLockTimeout || "immediately",
    lastSeenVisibility: u.lastSeenVisibility ?? "everyone",
    onlineStatusVisibility,
    profilePhotoVisibility: u.profilePhotoVisibility ?? "everyone",
    aboutVisibility: u.aboutVisibility ?? "everyone",
    statusVisibility: u.statusVisibility ?? "contacts",
    groupAddPermission: u.groupAddPermission ?? "everyone",
    lastSeenExceptions: toStrList(u.lastSeenExceptions),
    profilePhotoExceptions: toStrList(u.profilePhotoExceptions),
    aboutExceptions: toStrList(u.aboutExceptions),
    statusExceptions: toStrList(u.statusExceptions),
    statusIncluded: toStrList(u.statusIncluded),
    groupAddExceptions: toStrList(u.groupAddExceptions),
    lockedChats: toStrList(u.lockedChats),
  };
};

export const getPrivacy = async (userId) => {
  const user = await userRepository
    .findById(userId)
    .select(PRIVACY_SELECT + " +appLockPinHash");
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }
  return formatPrivacy(user);
};

export const setPrivacy = async (userId, body = {}, options = {}) => {
  const existingUser = await userRepository
    .findById(userId)
    .select("+appLockPinHash +password +lockEpoch lockedChats appLockEnabled");
  if (!existingUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const $set = {};
  const unknown = [];

  for (const [rawKey, val] of Object.entries(body)) {
    const key =
      rawKey === "whoCanAddMeToGroups" ? "groupAddPermission" : rawKey;

    if (PRIVACY_BOOL_FIELDS.includes(key)) {
      if (typeof val !== "boolean") {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `"${key}" must be a boolean.`,
        );
      }
      $set[key] = val;
    } else if (PRIVACY_VIS_FIELDS.includes(key)) {
      const allowed =
        key === "onlineStatusVisibility"
          ? ONLINE_VIS
          : key === "statusVisibility"
            ? STATUS_VIS
            : VIS;
      if (!allowed.includes(val)) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Invalid value for "${key}". Allowed: ${allowed.join(", ")}`,
        );
      }
      $set[key] = val;
    } else if (PRIVACY_ARRAY_FIELDS.includes(key)) {
      if (!Array.isArray(val)) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `"${key}" must be an array of IDs.`,
        );
      }
      const rawIds = [...new Set(val.map(String))];
      if (key === "lockedChats") {
        if (rawIds.length > MAX_LOCKED_CHATS) {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Cannot lock more than ${MAX_LOCKED_CHATS} chats.`,
          );
        }
        const validatedIds = [];
        for (const cid of rawIds) {
          if (!mongoose.Types.ObjectId.isValid(cid)) {
            throw new ApiError(
              StatusCodes.BAD_REQUEST,
              `Invalid conversation ID: ${cid}`,
            );
          }

          // Check if it is a group and verify the user is an active member
          const group = await groupRepository.findOne({
            _id: cid,
            "members.userId": userId,
          });
          if (group) {
            validatedIds.push(cid);
            continue;
          }

          // Otherwise check if it is a valid existing user
          const otherUser = await userRepository.findById(cid).select("_id");
          if (otherUser) {
            validatedIds.push(cid);
            continue;
          }

          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Invalid conversation or group: ${cid}`,
          );
        }
        $set[key] = validatedIds;
      } else {
        $set[key] = rawIds;
      }
    } else if (key === "appLockTimeout") {
      const timeouts = ["immediately", "1m", "5m", "15m", "1h"];
      if (!timeouts.includes(val)) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Invalid appLockTimeout. Allowed: ${timeouts.join(", ")}`,
        );
      }
      $set[key] = val;
    } else if (key === "appLockPinHash") {
      if (val !== null && typeof val !== "string") {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "appLockPinHash must be a string or null.",
        );
      }
      $set[key] = val;
    } else if (key === "pin" || key === "currentPin" || key === "password" || key === "accountPassword" || key === "unlockToken") {
      // Step-up authentication credentials carried in body
      continue;
    } else {
      unknown.push(rawKey);
    }
  }

  if (unknown.length) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Unknown field(s): ${unknown.join(", ")}`,
    );
  }

  // S1 Rule 1: Reject appLockEnabled: true unless valid PIN verifier exists or supplied in request
  if ($set.appLockEnabled === true) {
    const suppliedVerifier = typeof $set.appLockPinHash === "string" && $set.appLockPinHash.trim().length > 0;
    const existingVerifier = typeof existingUser.appLockPinHash === "string" && existingUser.appLockPinHash.trim().length > 0;
    if (!suppliedVerifier && !existingVerifier) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Cannot enable App Lock without configuring a PIN verifier.",
      );
    }
  }

  // S1 Rule 2: Step-up authentication required for disabling, PIN change, or removing locked chats
  const isDisablingAppLock =
    existingUser.appLockEnabled === true && $set.appLockEnabled === false;
  const isChangingPin =
    $set.appLockPinHash !== undefined &&
    Boolean(existingUser.appLockPinHash) &&
    $set.appLockPinHash !== existingUser.appLockPinHash;

  let isRemovingLockedChat = false;
  if ($set.lockedChats !== undefined) {
    const currentLocked = (existingUser.lockedChats || []).map(String);
    const newLockedSet = new Set($set.lockedChats.map(String));
    isRemovingLockedChat = currentLocked.some((cid) => !newLockedSet.has(cid));
  }

  if (isDisablingAppLock || isChangingPin || isRemovingLockedChat) {
    let authorized = false;
    const tokenCandidate =
      options.req?.headers?.["x-chat-unlock-token"] ||
      options.req?.headers?.["x-unlock-token"] ||
      body.unlockToken;

    if (tokenCandidate) {
      const decoded = verifyUnlockToken(tokenCandidate);
      if (
        decoded &&
        decoded.userId === String(userId) &&
        decoded.scope === "app" &&
        decoded.lockEpoch >= (existingUser.lockEpoch || 0)
      ) {
        authorized = true;
      }
    }

    if (!authorized && (body.pin || body.currentPin) && existingUser.appLockPinHash) {
      authorized = await verifyPinHash(body.pin || body.currentPin, existingUser.appLockPinHash);
    }

    if (!authorized && (body.password || body.accountPassword) && existingUser.password) {
      authorized = await existingUser.isPassword(body.password || body.accountPassword);
    }

    if (!authorized) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Step-up authentication (valid PIN, password, or app unlock token) is required to modify lock settings.",
      );
    }

    if (isDisablingAppLock || isChangingPin) {
      $set.lockEpoch = (existingUser.lockEpoch || 0) + 1;
      $set.lockFailedAttempts = 0;
      $set.lockoutUntil = null;
    }
  }

  if ($set.onlineStatusVisibility) {
    $set.showOnlineStatus = $set.onlineStatusVisibility !== "nobody";
  } else if ($set.showOnlineStatus !== undefined) {
    $set.onlineStatusVisibility = $set.showOnlineStatus ? "everyone" : "nobody";
  }

  if (!Object.keys($set).length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "No privacy fields provided.");
  }

  const updated = await userRepository
    .findByIdAndUpdate(userId, { $set }, { new: true, runValidators: true })
    .select(PRIVACY_SELECT + " +appLockPinHash");

  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  await refreshPrivacy(userId);

  return formatPrivacy(updated);
};

export const getChatPreferences = async (userId) => {
  const user = await userRepository
    .findById(userId)
    .select("enterToSend largeEmoji autoScroll");
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  return {
    enterToSend: user.enterToSend !== false,
    largeEmoji: user.largeEmoji !== false,
    autoScroll: user.autoScroll !== false,
  };
};

export const setChatPreferences = async (userId, body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid request body.");
  }

  const normalized = { ...body };
  if ("enterIsSend" in normalized && !("enterToSend" in normalized)) {
    normalized.enterToSend = normalized.enterIsSend;
    delete normalized.enterIsSend;
  }

  const $set = assertBooleanFields(normalized, CHAT_PREF_FIELDS, "chat-pref");

  const updated = await userRepository
    .findByIdAndUpdate(userId, { $set }, { new: true, runValidators: true })
    .select("enterToSend largeEmoji autoScroll");

  if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  return {
    enterToSend: updated.enterToSend !== false,
    largeEmoji: updated.largeEmoji !== false,
    autoScroll: updated.autoScroll !== false,
  };
};

export const getAppearanceSettings = async (userId) => {
  const user = await userRepository
    .findById(userId)
    .select(
      "theme fontSize bubbleStyle density showTimestamps timeFormat appearanceTheme appearanceFontSize appearanceBubbleStyle appearanceDensity appearanceTimestamps appearanceTimeFormat",
    );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  const appearance = {
    theme: user.theme ?? user.appearanceTheme ?? "light",
    fontSize: user.fontSize ?? user.appearanceFontSize ?? "md",
    bubbleStyle: user.bubbleStyle ?? user.appearanceBubbleStyle ?? "rounded",
    density: user.density ?? user.appearanceDensity ?? "comfortable",
    showTimestamps:
      (user.showTimestamps ?? user.appearanceTimestamps) !== false,
    timeFormat: user.timeFormat ?? user.appearanceTimeFormat ?? "12h",
  };

  return {
    appearance,
    ...appearance,
  };
};

const normalizeAppearanceValue = (key, val) => {
  if (key === "fontSize") {
    const map = { small: "sm", medium: "md", large: "lg" };
    return map[val] || val;
  }
  if (
    key === "bubbleStyle" ||
    key === "messageBubbleStyle" ||
    key === "bubble"
  ) {
    const map = {
      round: "rounded",
      modern: "rounded",
      classic: "soft",
      minimal: "sharp",
    };
    return map[val] || val;
  }
  if (key === "density" || key === "spacing" || key === "messageSpacing") {
    const map = { cozy: "comfortable" };
    return map[val] || val;
  }
  if (key === "timeFormat") {
    const map = { "12-hour": "12h", "24-hour": "24h" };
    return map[val] || val;
  }
  return val;
};

export const setAppearanceSettings = async (userId, body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid request body.");
  }

  const ALL_ALLOWED = [
    ...Object.keys(APPEARANCE_ENUMS),
    ...APPEARANCE_BOOL_FIELDS,
  ];

  const unknown = Object.keys(body).filter((k) => !ALL_ALLOWED.includes(k));
  if (unknown.length)
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Unknown field(s): ${unknown.join(", ")}`,
    );

  const $set = {};

  for (const [key, values] of Object.entries(APPEARANCE_ENUMS)) {
    if (key in body) {
      if (!values.includes(body[key]))
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `Invalid value for "${key}": ${body[key]}`,
        );
      const val = normalizeAppearanceValue(key, body[key]);
      const canonicalKey = CANONICAL_APPEARANCE_KEYS?.[key] || key;
      $set[canonicalKey] = val;
      const dbKey =
        APPEARANCE_DB_KEY[key] ??
        `appearance${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      $set[dbKey] = val;
    }
  }

  for (const key of APPEARANCE_BOOL_FIELDS) {
    if (key in body) {
      if (typeof body[key] !== "boolean")
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `"${key}" must be a boolean.`,
        );
      if (key === "compactMode") {
        const val = body[key] ? "compact" : "comfortable";
        $set["density"] = val;
        $set["appearanceDensity"] = val;
      } else {
        const canonicalKey = CANONICAL_APPEARANCE_KEYS?.[key] || key;
        $set[canonicalKey] = body[key];
        const dbKey =
          APPEARANCE_DB_KEY[key] ??
          `appearance${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        $set[dbKey] = body[key];
      }
    }
  }

  if (!Object.keys($set).length)
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No appearance fields provided.",
    );

  const updated = await userRepository
    .findByIdAndUpdate(userId, { $set }, { new: true, runValidators: true })
    .select(
      "theme fontSize bubbleStyle density showTimestamps timeFormat appearanceTheme appearanceFontSize appearanceBubbleStyle appearanceDensity appearanceTimestamps appearanceTimeFormat",
    );

  if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  const appearance = {
    theme: updated.theme ?? updated.appearanceTheme ?? "light",
    fontSize: updated.fontSize ?? updated.appearanceFontSize ?? "md",
    bubbleStyle:
      updated.bubbleStyle ?? updated.appearanceBubbleStyle ?? "rounded",
    density: updated.density ?? updated.appearanceDensity ?? "comfortable",
    showTimestamps:
      (updated.showTimestamps ?? updated.appearanceTimestamps) !== false,
    timeFormat: updated.timeFormat ?? updated.appearanceTimeFormat ?? "12h",
  };

  return {
    appearance,
    ...appearance,
  };
};

const userSettingsService = {
  getPrivacy,
  setPrivacy,
  getChatPreferences,
  setChatPreferences,
  getAppearanceSettings,
  setAppearanceSettings,
};

export default userSettingsService;
