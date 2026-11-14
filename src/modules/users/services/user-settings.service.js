/**
 * User Settings Service
 * Handles user preferences, privacy configurations, appearance, and chat behaviors.
 */

import { StatusCodes } from "http-status-codes";
import * as userRepository from "../repositories/user.repository.js";
import ApiError from "../../../shared/errors/api-error.js";
import { assertBooleanFields } from "../../../shared/utils/validators.js";
import {
  PRIVACY_FIELDS,
  PRIVACY_BOOL_FIELDS,
  PRIVACY_VIS_FIELDS,
  CHAT_PREF_FIELDS,
  APPEARANCE_ENUMS,
  APPEARANCE_BOOL_FIELDS,
  CANONICAL_APPEARANCE_KEYS,
  APPEARANCE_DB_KEY,
  VIS,
} from "../../privacy/constants/privacy.constants.js";
import { refreshPrivacy } from "../../../infrastructure/socket/socket.js";

const PRIVACY_SELECT =
  "showOnlineStatus onlineStatusVisibility readReceipts typingIndicator lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission";

const formatPrivacy = (u) => {
  const onlineStatusVisibility =
    u.onlineStatusVisibility ??
    (u.showOnlineStatus === false ? "nobody" : "everyone");
  return {
    showOnlineStatus: onlineStatusVisibility !== "nobody",
    readReceipts: u.readReceipts !== false,
    typingIndicator: u.typingIndicator !== false,
    lastSeenVisibility: u.lastSeenVisibility ?? "contacts",
    onlineStatusVisibility,
    profilePhotoVisibility: u.profilePhotoVisibility ?? "everyone",
    aboutVisibility: u.aboutVisibility ?? "contacts",
    groupAddPermission: u.groupAddPermission ?? "contacts",
  };
};

export const getPrivacy = async (userId) => {
  const user = await userRepository.findById(userId).select(PRIVACY_SELECT);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }
  return formatPrivacy(user);
};

export const setPrivacy = async (userId, body = {}) => {
  const boolBody = {};
  const visBody = {};
  const unknown = [];

  for (const [rawKey, val] of Object.entries(body)) {
    const key =
      rawKey === "whoCanAddMeToGroups" ? "groupAddPermission" : rawKey;
    if (PRIVACY_BOOL_FIELDS.includes(key)) {
      boolBody[key] = val;
    } else if (PRIVACY_VIS_FIELDS.includes(key)) {
      visBody[key] = val;
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

  const $set = {};

  if (Object.keys(boolBody).length) {
    Object.assign(
      $set,
      assertBooleanFields(boolBody, PRIVACY_BOOL_FIELDS, "privacy"),
    );
  }

  for (const [key, value] of Object.entries(visBody)) {
    if (!VIS.includes(value)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid value for "${key}". Allowed: ${VIS.join(", ")}`,
      );
    }
    $set[key] = value;
  }

  if (visBody.onlineStatusVisibility) {
    $set.showOnlineStatus = visBody.onlineStatusVisibility !== "nobody";
  } else if (boolBody.showOnlineStatus !== undefined) {
    $set.onlineStatusVisibility = boolBody.showOnlineStatus
      ? "everyone"
      : "nobody";
  }

  if (!Object.keys($set).length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "No privacy fields provided.");
  }

  const updated = await userRepository
    .findByIdAndUpdate(userId, { $set }, { new: true, runValidators: true })
    .select(PRIVACY_SELECT);

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
