import { StatusCodes } from "http-status-codes";
import User from "../../users/models/users.model.js";
import ApiError from "../../../shared/errors/api-error.js";
import {
  validateNotificationUpdateBody,
  validateNotificationPreferencesUpdateBody,
  validatePushSubscriptionBody,
} from "../validations/notification-settings.validation.js";
import { io, onlineUsers } from "../../../infrastructure/socket/socket.js";

export const DEFAULT_NOTIFICATION_SETTINGS = {
  soundEnabled: true,
  soundVolume: 60,
  desktopNotifications: false,
  showPreview: true,
};

export const DEFAULT_NOTIFICATION_PREFERENCES = {
  messagesPersonal: true,
  messagesGroup: true,
  messageReplies: true,
  messageMentions: true,
  messageReactions: true,
  mediaNotifications: true,
  callsVoice: true,
  callsVideo: true,
  callsMissed: true,
  callsGroup: true,
  contactRequests: true,
  contactAcceptance: true,
  groupInvitations: true,
  groupMembershipEvents: true,
  securityNewDevice: true,
  securityDeviceLinking: true,
  securityCredentialChanges: true,
  securityE2EEAlerts: true,
  systemAnnouncements: true,
  systemMaintenance: true,
  systemAlerts: true,
  dndEnabled: false,
  dndUntil: null,
  mutedConversations: [],
  mutedGroups: [],
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

export const formatNotificationPreferences = (userDoc) => {
  const np = userDoc?.notificationPreferences || {};
  const defaults = DEFAULT_NOTIFICATION_PREFERENCES;
  return {
    messagesPersonal: np.messagesPersonal !== undefined ? Boolean(np.messagesPersonal) : defaults.messagesPersonal,
    messagesGroup: np.messagesGroup !== undefined ? Boolean(np.messagesGroup) : defaults.messagesGroup,
    messageReplies: np.messageReplies !== undefined ? Boolean(np.messageReplies) : defaults.messageReplies,
    messageMentions: np.messageMentions !== undefined ? Boolean(np.messageMentions) : defaults.messageMentions,
    messageReactions: np.messageReactions !== undefined ? Boolean(np.messageReactions) : defaults.messageReactions,
    mediaNotifications: np.mediaNotifications !== undefined ? Boolean(np.mediaNotifications) : defaults.mediaNotifications,
    callsVoice: np.callsVoice !== undefined ? Boolean(np.callsVoice) : defaults.callsVoice,
    callsVideo: np.callsVideo !== undefined ? Boolean(np.callsVideo) : defaults.callsVideo,
    callsMissed: np.callsMissed !== undefined ? Boolean(np.callsMissed) : defaults.callsMissed,
    callsGroup: np.callsGroup !== undefined ? Boolean(np.callsGroup) : defaults.callsGroup,
    contactRequests: np.contactRequests !== undefined ? Boolean(np.contactRequests) : defaults.contactRequests,
    contactAcceptance: np.contactAcceptance !== undefined ? Boolean(np.contactAcceptance) : defaults.contactAcceptance,
    groupInvitations: np.groupInvitations !== undefined ? Boolean(np.groupInvitations) : defaults.groupInvitations,
    groupMembershipEvents: np.groupMembershipEvents !== undefined ? Boolean(np.groupMembershipEvents) : defaults.groupMembershipEvents,
    securityNewDevice: np.securityNewDevice !== undefined ? Boolean(np.securityNewDevice) : defaults.securityNewDevice,
    securityDeviceLinking: np.securityDeviceLinking !== undefined ? Boolean(np.securityDeviceLinking) : defaults.securityDeviceLinking,
    securityCredentialChanges: np.securityCredentialChanges !== undefined ? Boolean(np.securityCredentialChanges) : defaults.securityCredentialChanges,
    securityE2EEAlerts: np.securityE2EEAlerts !== undefined ? Boolean(np.securityE2EEAlerts) : defaults.securityE2EEAlerts,
    systemAnnouncements: np.systemAnnouncements !== undefined ? Boolean(np.systemAnnouncements) : defaults.systemAnnouncements,
    systemMaintenance: np.systemMaintenance !== undefined ? Boolean(np.systemMaintenance) : defaults.systemMaintenance,
    systemAlerts: np.systemAlerts !== undefined ? Boolean(np.systemAlerts) : defaults.systemAlerts,
    dndEnabled: np.dndEnabled !== undefined ? Boolean(np.dndEnabled) : defaults.dndEnabled,
    dndUntil: np.dndUntil ? new Date(np.dndUntil).toISOString() : null,
    mutedConversations: Array.isArray(np.mutedConversations) ? np.mutedConversations : [],
    mutedGroups: Array.isArray(np.mutedGroups) ? np.mutedGroups : [],
  };
};

export const getNotificationSettings = async (userId) => {
  const user = await User.findById(userId)
    .select("notificationSettings notificationPreferences")
    .lean();
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }
  return {
    settings: formatNotificationSettings(user),
    preferences: formatNotificationPreferences(user),
  };
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
    .select("notificationSettings notificationPreferences")
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
        userSockets.forEach((sId) => {
          if (sId !== excludeSocketId) {
            io.to(sId).emit("settings:notifications:updated", payload);
          }
        });
      } else {
        io.to(String(userId)).emit("settings:notifications:updated", payload);
      }
    }
  } catch (err) {
    console.error(
      "[notificationSettings] failed to emit socket update:",
      err?.message || err,
    );
  }

  return formatted;
};

export const updateNotificationPreferences = async (
  userId,
  body = {},
  options = {},
) => {
  const { valid, error, data } = validateNotificationPreferencesUpdateBody(body);
  if (!valid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error);
  }

  const $set = {};
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      $set[`notificationPreferences.${key}`] = val;
    }
  }

  if (Object.keys($set).length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "No valid preference fields provided.",
    );
  }

  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set },
    { new: true, runValidators: true },
  )
    .select("notificationPreferences")
    .lean();

  if (!updatedUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const formatted = formatNotificationPreferences(updatedUser);
  const updatedAt = new Date().toISOString();

  try {
    io.to(String(userId)).emit("settings:notifications:preferences:updated", {
      preferences: formatted,
      updatedAt,
    });
  } catch (err) {
    console.error("[notificationSettings] socket error:", err?.message);
  }

  return formatted;
};

export const muteChat = async (userId, { targetId, type = "user" }) => {
  if (!targetId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Target ID is required to mute.");
  }

  const field = type === "group" ? "notificationPreferences.mutedGroups" : "notificationPreferences.mutedConversations";
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $addToSet: { [field]: String(targetId) } },
    { new: true },
  ).select("notificationPreferences").lean();

  const formatted = formatNotificationPreferences(updatedUser);
  io.to(String(userId)).emit("settings:notifications:preferences:updated", {
    preferences: formatted,
    updatedAt: new Date().toISOString(),
  });

  return formatted;
};

export const unmuteChat = async (userId, { targetId, type = "user" }) => {
  if (!targetId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Target ID is required to unmute.");
  }

  const field = type === "group" ? "notificationPreferences.mutedGroups" : "notificationPreferences.mutedConversations";
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $pull: { [field]: String(targetId) } },
    { new: true },
  ).select("notificationPreferences").lean();

  const formatted = formatNotificationPreferences(updatedUser);
  io.to(String(userId)).emit("settings:notifications:preferences:updated", {
    preferences: formatted,
    updatedAt: new Date().toISOString(),
  });

  return formatted;
};

export const savePushSubscription = async (userId, body) => {
  const { valid, error, data } = validatePushSubscriptionBody(body);
  if (!valid) {
    throw new ApiError(StatusCodes.BAD_REQUEST, error);
  }

  // Remove existing subscription with same endpoint if exists, then add
  await User.findByIdAndUpdate(userId, {
    $pull: {
      "notificationPreferences.pushSubscriptions": { endpoint: data.endpoint },
    },
  });

  await User.findByIdAndUpdate(userId, {
    $push: {
      "notificationPreferences.pushSubscriptions": {
        endpoint: data.endpoint,
        keys: data.keys,
        userAgent: data.userAgent || "",
        createdAt: new Date(),
      },
    },
  });

  return { success: true };
};

export const removePushSubscription = async (userId, endpoint) => {
  if (!endpoint) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Endpoint is required.");
  }
  await User.findByIdAndUpdate(userId, {
    $pull: {
      "notificationPreferences.pushSubscriptions": { endpoint },
    },
  });
  return { success: true };
};
