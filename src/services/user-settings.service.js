import User from "../models/users.model.js";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import { refreshPrivacy } from "../lib/socket.js";
import { assertBooleanFields } from "../utils/validators.js";
import {
  PRIVACY_FIELDS,
  CHAT_PREF_FIELDS,
  APPEARANCE_ENUMS,
  APPEARANCE_BOOL_FIELDS,
  APPEARANCE_DB_KEY,
} from "../constants/constants.js";

export const getPrivacy = async (userId) => {
  const user = await User.findById(userId).select(
    "showOnlineStatus readReceipts typingIndicator",
  );
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  return {
    showOnlineStatus: user.showOnlineStatus !== false,
    readReceipts: user.readReceipts !== false,
    typingIndicator: user.typingIndicator !== false,
  };
};

export const setPrivacy = async (userId, body) => {
  const $set = assertBooleanFields(body, PRIVACY_FIELDS, "privacy");

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set },
    { new: true, runValidators: true },
  ).select("showOnlineStatus readReceipts typingIndicator");

  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const privacy = {
    showOnlineStatus: updated.showOnlineStatus !== false,
    readReceipts: updated.readReceipts !== false,
    typingIndicator: updated.typingIndicator !== false,
  };

  await refreshPrivacy(userId);

  return privacy;
};

export const getChatPreferences = async (userId) => {
  const user = await User.findById(userId).select(
    "enterToSend largeEmoji autoScroll",
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  return {
    enterToSend: user.enterToSend !== false,
    largeEmoji: user.largeEmoji !== false,
    autoScroll: user.autoScroll !== false,
  };
};

export const setChatPreferences = async (userId, body) => {
  const $set = assertBooleanFields(body, CHAT_PREF_FIELDS, "chat-pref");

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set },
    { new: true, runValidators: true },
  ).select("enterToSend largeEmoji autoScroll");

  if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  return {
    enterToSend: updated.enterToSend !== false,
    largeEmoji: updated.largeEmoji !== false,
    autoScroll: updated.autoScroll !== false,
  };
};

export const getAppearanceSettings = async (userId) => {
  const user = await User.findById(userId).select(
    "appearanceTheme appearanceFontSize appearanceBubbleStyle appearanceDensity appearanceTimestamps appearanceTimeFormat",
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  return {
    theme: user.appearanceTheme ?? "light",
    fontSize: user.appearanceFontSize ?? "md",
    bubbleStyle: user.appearanceBubbleStyle ?? "rounded",
    density: user.appearanceDensity ?? "comfortable",
    showTimestamps: user.appearanceTimestamps !== false,
    timeFormat: user.appearanceTimeFormat ?? "12h",
  };
};

export const setAppearanceSettings = async (userId, body) => {
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
      const dbKey =
        APPEARANCE_DB_KEY[key] ??
        `appearance${key.charAt(0).toUpperCase()}${key.slice(1)}`;
      $set[dbKey] = body[key];
    }
  }

  for (const key of APPEARANCE_BOOL_FIELDS) {
    if (key in body) {
      if (typeof body[key] !== "boolean")
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `"${key}" must be a boolean.`,
        );
      $set.appearanceTimestamps = body[key];
    }
  }

  if (!Object.keys($set).length)
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No appearance fields provided.",
    );

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set },
    { new: true, runValidators: false },
  ).select(
    "appearanceTheme appearanceFontSize appearanceBubbleStyle appearanceDensity appearanceTimestamps appearanceTimeFormat",
  );

  if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  return {
    theme: updated.appearanceTheme ?? "light",
    fontSize: updated.appearanceFontSize ?? "md",
    bubbleStyle: updated.appearanceBubbleStyle ?? "rounded",
    density: updated.appearanceDensity ?? "comfortable",
    showTimestamps: updated.appearanceTimestamps !== false,
    timeFormat: updated.appearanceTimeFormat ?? "12h",
  };
};
