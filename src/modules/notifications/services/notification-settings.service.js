import { StatusCodes } from "http-status-codes";
import User from "../../users/models/users.model.js";
import ApiError from "../../../shared/errors/api-error.js";
import { validateNotificationUpdateBody } from "../validations/notification-settings.validation.js";
import { io, onlineUsers } from "../../../infrastructure/socket/socket.js";

export const DEFAULT_NOTIFICATION_SETTINGS = {
  soundEnabled: true,
  soundVolume: 60,
  desktopNotifications: false,
  showPreview: true,
};

export const formatNotificationSettings = (userDoc) => {
  const ns = userDoc?.notificationSettings || {};
  return {
    soundEnabled:
      ns.soundEnabled !== undefined
        ? Boolean(ns.soundEnabled)
        : DEFAULT_NOTIFICATION_SETTINGS.soundEnabled,
    soundVolume:
      typeof ns.soundVolume === "number" && !Number.isNaN(ns.soundVolume)
        ? Math.max(0, Math.min(100, Math.round(ns.soundVolume)))
        : DEFAULT_NOTIFICATION_SETTINGS.soundVolume,
    desktopNotifications:
      ns.desktopNotifications !== undefined
        ? Boolean(ns.desktopNotifications)
        : DEFAULT_NOTIFICATION_SETTINGS.desktopNotifications,
    showPreview:
      ns.showPreview !== undefined
        ? Boolean(ns.showPreview)
        : DEFAULT_NOTIFICATION_SETTINGS.showPreview,
  };
};

export const getNotificationSettings = async (userId) => {
  const user = await User.findById(userId).select("notificationSettings").lean();
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }
  return formatNotificationSettings(user);
};

export const updateNotificationSettings = async (
  userId,
  body = {},
  options = {},
) => {
  const { valid, error, data } = validateNotificationUpdateBody(body);
  if (!valid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error);
  }

  const $set = {};
  if (data.soundEnabled !== undefined) {
    $set["notificationSettings.soundEnabled"] = data.soundEnabled;
  }
  if (data.soundVolume !== undefined) {
    $set["notificationSettings.soundVolume"] = data.soundVolume;
  }
  if (data.desktopNotifications !== undefined) {
    $set["notificationSettings.desktopNotifications"] = data.desktopNotifications;
  }
  if (data.showPreview !== undefined) {
    $set["notificationSettings.showPreview"] = data.showPreview;
  }

  if (Object.keys($set).length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No valid notification fields provided.",
    );
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set },
    { new: true, runValidators: true },
  )
    .select("notificationSettings")
    .lean();

  if (!updatedUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const formatted = formatNotificationSettings(updatedUser);
  const updatedAt = new Date().toISOString();

  // Socket broadcast to user's connected devices/tabs
  try {
    const userSockets = onlineUsers.get(String(userId));
    if (userSockets && userSockets.size > 0) {
      const payload = {
        settings: formatted,
        updatedAt,
      };

      const excludeSocketId = options.excludeSocketId;
      if (excludeSocketId) {
        userSockets.forEach((sock) => {
          if (sock.id !== excludeSocketId) {
            sock.emit("settings:notifications:updated", payload);
          }
        });
      } else {
        io.to(String(userId)).emit("settings:notifications:updated", payload);
      }
    }
  } catch (socketErr) {
    console.error(
      "[notification-settings] socket broadcast failed:",
      socketErr?.message || socketErr,
    );
  }

  return formatted;
};

export default {
  DEFAULT_NOTIFICATION_SETTINGS,
  formatNotificationSettings,
  getNotificationSettings,
  updateNotificationSettings,
};
