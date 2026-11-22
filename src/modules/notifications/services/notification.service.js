/**
 * Notification Service
 * Domain service for managing persistent notifications, unread counts, and real-time socket delivery.
 */

import { io } from "../../../infrastructure/socket/socket.js";
import * as notificationRepo from "../repositories/notification.repository.js";
import { TYPE_CATEGORY_MAP } from "../models/notification.model.js";
import User from "../../users/models/users.model.js";
import { assertValidObjectId } from "../../../shared/utils/object-id.util.js";
import ApiError from "../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";

/**
 * Checks if a notification type is allowed based on user preferences.
 */
const isTypePermitted = (type, preferences = {}) => {
  switch (type) {
    case "message_received":
    case "gift_received":
      return preferences.messagesPersonal !== false;
    case "message_reply":
      return preferences.messageReplies !== false;
    case "message_mention":
      return preferences.messageMentions !== false;
    case "message_reaction":
      return preferences.messageReactions !== false;
    case "media_received":
    case "location_shared":
      return preferences.mediaNotifications !== false;
    case "group_message_received":
      return preferences.messagesGroup !== false;
    case "group_reply":
      return preferences.messageReplies !== false;
    case "group_mention":
    case "group_mention_all":
    case "group_mention_everyone":
      return preferences.messageMentions !== false;
    case "group_reaction":
      return preferences.messageReactions !== false;
    case "group_invite_received":
    case "group_invite_accepted":
      return preferences.groupInvitations !== false;
    case "group_member_added":
    case "group_member_removed":
    case "group_member_left":
    case "group_role_changed":
    case "group_ownership_transferred":
    case "group_info_updated":
    case "group_message_pinned":
      return preferences.groupMembershipEvents !== false;
    case "story_reply":
      return (
        preferences.storiesReplies !== false &&
        preferences.messageReplies !== false
      );
    case "story_reaction":
      return (
        preferences.storiesReactions !== false &&
        preferences.messageReactions !== false
      );
    case "story_mention":
      return (
        preferences.storiesMentions !== false &&
        preferences.messageMentions !== false
      );
    case "story_favorite_posted":
      return preferences.storiesFavorites !== false;
    case "call_incoming_voice":
      return preferences.callsVoice !== false;
    case "call_incoming_video":
      return preferences.callsVideo !== false;
    case "call_missed_voice":
    case "call_missed_video":
      return preferences.callsMissed !== false;
    case "group_call_started":
    case "group_call_invited":
      return preferences.callsGroup !== false;
    case "contact_request_received":
    case "contact_request_cancelled":
      return preferences.contactRequests !== false;
    case "contact_request_accepted":
    case "contact_request_rejected":
    case "contact_removed":
      return preferences.contactAcceptance !== false;
    case "security_new_device":
      return preferences.securityNewDevice !== false;
    case "security_device_linked":
    case "security_device_unlinked":
      return preferences.securityDeviceLinking !== false;
    case "security_password_changed":
      return preferences.securityCredentialChanges !== false;
    case "security_2fa_enabled":
    case "security_2fa_disabled":
    case "security_session_revoked":
      return preferences.securityCredentialChanges !== false;
    case "security_e2ee_alert":
      return preferences.securityE2EEAlerts !== false;
    case "system_announcement":
      return preferences.systemAnnouncements !== false;
    case "system_maintenance":
      return preferences.systemMaintenance !== false;
    case "system_security_alert":
      return preferences.systemAlerts !== false;
    default:
      return true;
  }
};

/**
 * Checks whether user is currently in Do Not Disturb mode.
 */
const isUserInDND = (preferences = {}) => {
  if (!preferences.dndEnabled) return false;
  if (!preferences.dndUntil) return true;
  const dndExpiry = new Date(preferences.dndUntil).getTime();
  return Date.now() < dndExpiry;
};

/**
 * Checks whether user is currently within configured Quiet Hours.
 */
export const isUserInQuietHours = (preferences = {}) => {
  if (!preferences.quietHoursEnabled) return false;

  const tz = preferences.quietHoursTimezone || "UTC";
  const now = new Date();

  let hoursStr = "0";
  let minutesStr = "0";
  let dayName = "monday";
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      weekday: "long",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    for (const part of parts) {
      if (part.type === "hour") hoursStr = part.value;
      if (part.type === "minute") minutesStr = part.value;
      if (part.type === "weekday") dayName = part.value.toLowerCase();
    }
  } catch (_e) {
    hoursStr = String(now.getUTCHours());
    minutesStr = String(now.getUTCMinutes());
    dayName = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ][now.getUTCDay()];
  }

  const days = Array.isArray(preferences.quietHoursDays)
    ? preferences.quietHoursDays.map((d) => d.toLowerCase())
    : ["everyday"];

  if (!days.includes("everyday")) {
    const isWeekend = dayName === "saturday" || dayName === "sunday";
    const isWeekday = !isWeekend;
    if (days.includes("weekdays") && !isWeekday) return false;
    if (days.includes("weekends") && !isWeekend) return false;
    if (
      !days.includes("weekdays") &&
      !days.includes("weekends") &&
      !days.includes(dayName)
    ) {
      return false;
    }
  }

  const currentMinutes = parseInt(hoursStr, 10) * 60 + parseInt(minutesStr, 10);
  const [startH, startM] = (preferences.quietHoursStart || "22:00")
    .split(":")
    .map(Number);
  const [endH, endM] = (preferences.quietHoursEnd || "08:00")
    .split(":")
    .map(Number);

  const startMinutes = (startH || 0) * 60 + (startM || 0);
  const endMinutes = (endH || 0) * 60 + (endM || 0);

  if (startMinutes === endMinutes) {
    return true;
  }

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight window (e.g. 22:00 to 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
};

/**
 * Applies notification preview privacy (full, sender_only, hidden).
 */
export const applyPreviewPrivacy = (
  title,
  body,
  previewPrivacy = "full",
  category = "system",
  type = "",
  senderName = "Someone",
) => {
  if (category === "security" || type === "system_security_alert") {
    return { title, body };
  }

  if (previewPrivacy === "hidden") {
    return {
      title: "Chatty",
      body: "You have a new notification",
    };
  }

  if (previewPrivacy === "sender_only") {
    let safeBody = "New notification";
    if (category === "message") safeBody = "New message";
    else if (category === "group") safeBody = "New group activity";
    else if (category === "call") safeBody = "Incoming call";
    else if (category === "contact") safeBody = "Contact update";
    else if (category === "story") safeBody = "Story update";

    return {
      title: senderName || "Someone",
      body: safeBody,
    };
  }

  return { title, body };
};

/**
 * Dispatches a notification across DB, Socket.IO, and Push.
 */
export const dispatchNotification = async ({
  recipientId,
  senderId = null,
  category,
  type,
  title,
  body = "",
  data = {},
  dedupKey = null,
  priority = "normal",
  expiresAt = null,
}) => {
  if (!recipientId || !type || !title) return null;

  // Never notify oneself
  if (senderId && String(recipientId) === String(senderId)) {
    return null;
  }

  try {
    const resolvedCategory =
      category || TYPE_CATEGORY_MAP[type] || "system";

    // 1. Check user preferences & DND
    const user = await User.findById(recipientId)
      .select("notificationPreferences notificationSettings mutedChats")
      .lean();

    if (user) {
      const prefs = user.notificationPreferences || {};
      const isCritical =
        priority === "critical" ||
        resolvedCategory === "security" ||
        type === "system_security_alert";

      // Non-critical notifications must respect DND, quiet hours, and master switch
      if (!isCritical) {
        if (
          prefs.masterEnabled === false ||
          user.notificationSettings?.masterEnabled === false
        ) {
          return null; // Suppressed by Master Notification Switch
        }

        if (isUserInDND(prefs)) {
          return null; // Suppressed by DND
        }

        if (isUserInQuietHours(prefs)) {
          return null; // Suppressed by Quiet Hours
        }

        if (!isTypePermitted(type, prefs)) {
          return null; // Suppressed by user category preference
        }

        // Check muted personal conversations
        const mutedChats = [
          ...(user.mutedChats || []).map(String),
          ...(prefs.mutedConversations || []).map(String),
        ];
        if (
          senderId &&
          mutedChats.includes(String(senderId)) &&
          type !== "message_mention"
        ) {
          return null; // Muted chat
        }

        // Check muted groups
        const mutedGroups = (prefs.mutedGroups || []).map(String);
        if (
          data.groupId &&
          mutedGroups.includes(String(data.groupId)) &&
          type !== "group_mention" &&
          type !== "group_mention_all" &&
          type !== "group_mention_everyone"
        ) {
          return null; // Muted group
        }
      }
    }

    // 2. Check deduplication
    const isDuplicate = await notificationRepo.findRecentDuplicate(
      recipientId,
      type,
      senderId,
      3000,
      dedupKey,
    );
    if (isDuplicate) {
      return isDuplicate;
    }

    // 3. Persist notification
    const doc = await notificationRepo.create({
      recipientId,
      senderId: senderId || undefined,
      category: resolvedCategory,
      type,
      title,
      body,
      data,
      dedupKey: dedupKey || undefined,
      expiresAt: expiresAt || undefined,
    });

    const [unreadCount, categoryCounts] = await Promise.all([
      notificationRepo.countUnread(recipientId),
      notificationRepo.countUnreadByCategory(recipientId),
    ]);

    const populated = await doc.populate(
      "senderId",
      "fullName username avatar profilePic",
    );

    const userSettings = user?.notificationSettings || {};
    const privacyPref =
      userSettings.previewPrivacy ||
      (userSettings.showPreview === false ? "hidden" : "full");
    const { title: finalTitle, body: finalBody } = applyPreviewPrivacy(
      populated.title,
      populated.body,
      privacyPref,
      populated.category,
      populated.type,
      populated.senderId?.fullName || "Someone",
    );

    const payload = {
      id: String(populated._id),
      _id: populated._id,
      category: populated.category,
      type: populated.type,
      title: finalTitle,
      body: finalBody,
      data: populated.data,
      isRead: populated.isRead,
      createdAt: populated.createdAt,
      sender: populated.senderId
        ? {
            id: String(populated.senderId._id),
            _id: populated.senderId._id,
            fullName: populated.senderId.fullName,
            username: populated.senderId.username,
            avatar:
              populated.senderId.avatar?.url ||
              (typeof populated.senderId.avatar === "string"
                ? populated.senderId.avatar
                : populated.senderId.profilePic || ""),
          }
        : null,
    };

    // 4. Emit real-time events to user room
    io.to(String(recipientId)).emit("notification:new", payload);
    io.to(String(recipientId)).emit("notification:count:updated", {
      count: unreadCount,
      categoryCounts,
    });

    return payload;
  } catch (err) {
    console.error("[notification.service] dispatchNotification error:", err?.message || err);
    return null;
  }
};

/**
 * Backward-compatible wrapper for sendNotification.
 */
export const sendNotification = async ({
  userId,
  senderId = null,
  type,
  title,
  body = "",
  data = {},
  category = null,
  dedupKey = null,
  priority = "normal",
}) => {
  return dispatchNotification({
    recipientId: userId,
    senderId,
    category,
    type,
    title,
    body,
    data,
    dedupKey,
    priority,
  });
};

export const getNotifications = async (userId, query = {}) => {
  assertValidObjectId(userId, "Invalid user ID.");

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  let isReadFilter = undefined;
  if (query.unreadOnly === "true" || query.isRead === "false") {
    isReadFilter = false;
  } else if (query.isRead === "true") {
    isReadFilter = true;
  }

  const category = query.category || "all";
  const search = query.search || query.q || "";

  const [{ items, total }, unreadCount, categoryCounts] = await Promise.all([
    notificationRepo.findByRecipient(userId, {
      skip,
      limit,
      isRead: isReadFilter,
      category,
      search,
    }),
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);

  const formattedItems = items.map((n) => ({
    id: String(n._id),
    _id: n._id,
    category: n.category,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    isRead: n.isRead,
    createdAt: n.createdAt,
    sender: n.senderId
      ? {
          id: String(n.senderId._id),
          _id: n.senderId._id,
          fullName: n.senderId.fullName,
          username: n.senderId.username,
          avatar:
            n.senderId.avatar?.url ||
            (typeof n.senderId.avatar === "string"
              ? n.senderId.avatar
              : n.senderId.profilePic || ""),
        }
      : null,
  }));

  return {
    items: formattedItems,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    unreadCount,
    categoryCounts,
  };
};

export const getUnreadCount = async (userId) => {
  assertValidObjectId(userId, "Invalid user ID.");
  const [count, categoryCounts] = await Promise.all([
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);
  return { count, categoryCounts };
};

export const markAsRead = async (userId, notificationId) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(notificationId, "Invalid notification ID.");

  const updated = await notificationRepo.markRead(userId, notificationId);
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Notification not found.");
  }

  const [unreadCount, categoryCounts] = await Promise.all([
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);

  io.to(String(userId)).emit("notification:read", {
    id: String(notificationId),
    category: updated.category,
  });
  io.to(String(userId)).emit("notification:count:updated", {
    count: unreadCount,
    categoryCounts,
  });

  return { id: String(notificationId), isRead: true, unreadCount, categoryCounts };
};

export const markAsUnread = async (userId, notificationId) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(notificationId, "Invalid notification ID.");

  const updated = await notificationRepo.markUnread(userId, notificationId);
  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Notification not found.");
  }

  const [unreadCount, categoryCounts] = await Promise.all([
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);

  io.to(String(userId)).emit("notification:unread", {
    id: String(notificationId),
    category: updated.category,
  });
  io.to(String(userId)).emit("notification:count:updated", {
    count: unreadCount,
    categoryCounts,
  });

  return { id: String(notificationId), isRead: false, unreadCount, categoryCounts };
};

export const markAllAsRead = async (userId, category = null) => {
  assertValidObjectId(userId, "Invalid user ID.");
  await notificationRepo.markAllRead(userId, category);

  const [unreadCount, categoryCounts] = await Promise.all([
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);

  io.to(String(userId)).emit("notification:count:updated", {
    count: unreadCount,
    categoryCounts,
  });

  return { success: true, unreadCount, categoryCounts };
};

export const deleteNotification = async (userId, notificationId) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(notificationId, "Invalid notification ID.");

  const deleted = await notificationRepo.deleteById(userId, notificationId);
  if (!deleted) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Notification not found.");
  }

  const [unreadCount, categoryCounts] = await Promise.all([
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);

  io.to(String(userId)).emit("notification:deleted", { id: String(notificationId) });
  io.to(String(userId)).emit("notification:count:updated", {
    count: unreadCount,
    categoryCounts,
  });

  return { id: String(notificationId), deleted: true, unreadCount, categoryCounts };
};

export const clearAllNotifications = async (userId, category = null) => {
  assertValidObjectId(userId, "Invalid user ID.");
  await notificationRepo.deleteAll(userId, category);

  const [unreadCount, categoryCounts] = await Promise.all([
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);

  io.to(String(userId)).emit("notification:cleared", { category: category || "all" });
  io.to(String(userId)).emit("notification:count:updated", {
    count: unreadCount,
    categoryCounts,
  });

  return { success: true, unreadCount, categoryCounts };
};

export const clearReadNotifications = async (userId, category = null) => {
  assertValidObjectId(userId, "Invalid user ID.");
  await notificationRepo.clearRead(userId, category);

  const [unreadCount, categoryCounts] = await Promise.all([
    notificationRepo.countUnread(userId),
    notificationRepo.countUnreadByCategory(userId),
  ]);

  io.to(String(userId)).emit("notification:cleared", {
    category: category || "all",
  });
  io.to(String(userId)).emit("notification:count:updated", {
    count: unreadCount,
    categoryCounts,
  });

  return { success: true, unreadCount, categoryCounts };
};

export default {
  dispatchNotification,
  sendNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
  clearReadNotifications,
};
