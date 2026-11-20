import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../shared/errors/api-error.js";
import Message from "../../models/message.model.js";
import GroupMessage from "../../../groups/models/group-message.model.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { getGroupAndMember } from "../../../groups/helpers/group.member.helpers.js";
import { io } from "../../../../infrastructure/socket/socket.js";
import * as notificationService from "../../../notifications/services/notification.service.js";
import { assertValidObjectId, toObjectId } from "../../../../shared/utils/object-id.util.js";

/**
 * Builds aggregated reaction breakdown and summary.
 */
export const buildReactionSummary = (reactions = []) => {
  const map = new Map();

  for (const r of reactions) {
    const emoji = r.emoji;
    if (!map.has(emoji)) {
      map.set(emoji, {
        emoji,
        count: 0,
        users: [],
      });
    }
    const item = map.get(emoji);
    item.count++;
    if (r.userId) {
      item.users.push(
        typeof r.userId === "object"
          ? {
              id: String(r.userId._id || r.userId.id),
              fullName: r.userId.fullName || "User",
              username: r.userId.username || "",
              avatar:
                r.userId.avatar?.url ||
                (typeof r.userId.avatar === "string" ? r.userId.avatar : ""),
            }
          : { id: String(r.userId) },
      );
    }
  }

  return {
    total: reactions.length,
    summary: Array.from(map.values()).sort((a, b) => b.count - a.count),
  };
};

/**
 * Adds, updates, or removes an emoji reaction on a direct or group message.
 */
export const toggleReaction = async ({
  userId,
  messageId,
  emoji,
  isGroup = false,
  groupId = null,
  allowMultiple = false,
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(messageId, "Invalid message ID.");

  if (!emoji || typeof emoji !== "string" || emoji.length > 32) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "A valid emoji is required.");
  }

  let message;
  let roomTarget;

  if (isGroup) {
    if (!groupId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Group ID is required.");
    }
    const { group } = await getGroupAndMember(groupId, userId);
    message = await GroupMessage.findOne({
      _id: toObjectId(messageId),
      groupId: toObjectId(groupId),
      isDeleted: { $ne: true },
    });
    roomTarget = `group:${groupId}`;
  } else {
    message = await Message.findOne({
      _id: toObjectId(messageId),
      isDeleted: { $ne: true },
    });
    if (!message) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }

    const isParticipant =
      String(message.senderId) === String(userId) ||
      String(message.receiverId) === String(userId);
    if (!isParticipant) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Not authorized to react to this message.");
    }

    const peerId =
      String(message.senderId) === String(userId)
        ? message.receiverId
        : message.senderId;
    await assertCanMessage(userId, peerId);
  }

  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }

  if (!Array.isArray(message.reactions)) {
    message.reactions = [];
  }

  const uIdStr = String(userId);
  const existingSameEmojiIndex = message.reactions.findIndex(
    (r) => String(r.userId?._id || r.userId) === uIdStr && r.emoji === emoji,
  );

  let action = "added";

  if (existingSameEmojiIndex !== -1) {
    // Exact same emoji clicked -> toggle off (remove)
    message.reactions.splice(existingSameEmojiIndex, 1);
    action = "removed";
  } else if (!allowMultiple) {
    // Single reaction mode: replace previous reaction by this user
    const prevIndex = message.reactions.findIndex(
      (r) => String(r.userId?._id || r.userId) === uIdStr,
    );
    if (prevIndex !== -1) {
      message.reactions[prevIndex].emoji = emoji;
      message.reactions[prevIndex].createdAt = new Date();
      action = "replaced";
    } else {
      message.reactions.push({ userId, emoji, createdAt: new Date() });
      action = "added";
    }
  } else {
    // Multi-reaction mode: add new distinct emoji
    message.reactions.push({ userId, emoji, createdAt: new Date() });
    action = "added";
  }

  await message.save();

  // Populate users to compute summary
  await message.populate("reactions.userId", "fullName username avatar profilePic");

  const { total, summary } = buildReactionSummary(message.reactions);

  const payload = {
    messageId: String(message._id),
    reactions: message.reactions.map((r) => ({
      userId: String(r.userId?._id || r.userId),
      emoji: r.emoji,
      createdAt: r.createdAt,
    })),
    summary,
    total,
    reactionSummary: { total, summary },
    action,
  };

  // Broadcast Socket.IO event
  if (isGroup) {
    io.to(String(groupId)).emit("groupMessageReaction", {
      ...payload,
      groupId: String(groupId),
    });
  } else {
    const sId = String(message.senderId);
    const rId = String(message.receiverId);
    io.to(sId).to(rId).emit("messageReaction", payload);
  }

  // Dispatch notification to message creator if new reaction
  if (action === "added" && String(message.senderId) !== uIdStr) {
    notificationService
      .dispatchNotification({
        recipientId: message.senderId,
        senderId: userId,
        category: isGroup ? "group" : "message",
        type: isGroup ? "group_reaction" : "message_reaction",
        title: isGroup ? "New Group Reaction" : "New Message Reaction",
        body: `Reacted with ${emoji} to your message`,
        data: isGroup
          ? { groupId: String(groupId), messageId: String(message._id), emoji }
          : { conversationId: uIdStr, peerId: uIdStr, messageId: String(message._id), emoji },
      })
      .catch(() => {});
  }

  return payload;
};

/**
 * Gets detailed reaction breakdown with users for a message.
 */
export const getReactionDetails = async ({
  userId,
  messageId,
  isGroup = false,
  groupId = null,
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(messageId, "Invalid message ID.");

  let message;
  if (isGroup) {
    if (!groupId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Group ID is required.");
    }
    await getGroupAndMember(groupId, userId);
    message = await GroupMessage.findOne({
      _id: toObjectId(messageId),
      groupId: toObjectId(groupId),
      isDeleted: { $ne: true },
    }).populate("reactions.userId", "fullName username avatar profilePic");
  } else {
    message = await Message.findOne({
      _id: toObjectId(messageId),
      isDeleted: { $ne: true },
    }).populate("reactions.userId", "fullName username avatar profilePic");

    if (message) {
      const isParticipant =
        String(message.senderId) === String(userId) ||
        String(message.receiverId) === String(userId);
      if (!isParticipant) {
        throw new ApiError(StatusCodes.FORBIDDEN, "Not authorized.");
      }
    }
  }

  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }

  const { total, summary } = buildReactionSummary(message.reactions || []);

  return {
    messageId: String(message._id),
    reactions: message.reactions || [],
    summary,
    total,
    reactionSummary: { total, summary },
  };
};

export default {
  toggleReaction,
  getReactionDetails,
  buildReactionSummary,
};
