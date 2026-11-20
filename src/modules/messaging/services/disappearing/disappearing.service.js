import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../shared/errors/api-error.js";
import Message from "../../models/message.model.js";
import GroupMessage from "../../../groups/models/group-message.model.js";
import Group from "../../../groups/models/group.model.js";
import { getGroupAndMember } from "../../../groups/helpers/group.member.helpers.js";
import { io } from "../../../../infrastructure/socket/socket.js";
import { wipeMessage } from "../../utils/message-cleanup.js";
import {
  deleteMedia,
  emitGroupConversation,
} from "../../../groups/services/group.service.js";
import { broadcastGroupMessageDeleted } from "../../../groups/events/group.events.js";
import { emitConversationUpdate } from "../../utils/message-helpers.js";
import {
  assertValidObjectId,
  toObjectId,
} from "../../../../shared/utils/object-id.util.js";

export const setGroupDisappearing = async ({ userId, groupId, seconds }) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(groupId, "Invalid group ID.");

  const s = parseInt(seconds, 10);
  if (isNaN(s) || s < 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid disappearing seconds value.",
    );
  }

  const { group, member } = await getGroupAndMember(groupId, userId);
  const isAdminOrOwner =
    member?.role === "admin" || String(group.owner) === String(userId);
  if (!isAdminOrOwner) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only admins can change group disappearing messages.",
    );
  }

  group.disappearAfter = s;
  await group.save();

  const payload = {
    groupId: String(group._id),
    disappearAfter: s,
    updatedBy: String(userId),
  };

  io.to(`group:${groupId}`).emit("groupDisappearingUpdated", payload);
  await emitGroupConversation(group);

  return payload;
};

/**
 * Marks a view-once media message as opened, immediately purging media if direct or viewed.
 */
export const markViewOnceOpened = async ({
  userId,
  messageId,
  isGroup = false,
  groupId = null,
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(messageId, "Invalid message ID.");

  let message;
  let roomTarget;

  if (isGroup) {
    if (!groupId)
      throw new ApiError(StatusCodes.BAD_REQUEST, "groupId is required.");
    await getGroupAndMember(groupId, userId);
    message = await GroupMessage.findOne({
      _id: toObjectId(messageId),
      groupId: toObjectId(groupId),
      isDeleted: { $ne: true },
    });
    if (!message)
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");

    if (!message.isViewOnce) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "This message is not a view-once message.",
      );
    }

    if (!message.viewOnceViewedBy.some((id) => String(id) === String(userId))) {
      message.viewOnceViewedBy.push(toObjectId(userId));
    }

    // In group, if all active recipients have viewed or once opened by viewer
    await message.save();

    roomTarget = `group:${groupId}`;
    io.to(roomTarget).emit("viewOnceOpened", {
      messageId: String(message._id),
      userId: String(userId),
      isGroup: true,
      groupId: String(groupId),
    });

    return {
      success: true,
      messageId: String(message._id),
      viewOnceExpired: Boolean(message.viewOnceExpired),
    };
  }

  // Direct 1-to-1 message
  message = await Message.findOne({
    _id: toObjectId(messageId),
    isDeleted: { $ne: true },
  });

  if (!message) throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");

  if (!message.isViewOnce) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This message is not a view-once message.",
    );
  }

  const isReceiver = String(message.receiverId) === String(userId);
  if (!isReceiver) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only the recipient can open view-once media.",
    );
  }

  if (message.viewOnceExpired) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This view-once media has already been opened and expired.",
    );
  }

  // Mark viewed and expire media immediately
  if (!message.viewOnceViewedBy.some((id) => String(id) === String(userId))) {
    message.viewOnceViewedBy.push(toObjectId(userId));
  }
  message.viewOnceExpired = true;

  // Wipe media file URLs
  await wipeMessage(message);

  io.to(String(message.senderId))
    .to(String(message.receiverId))
    .emit("viewOnceOpened", {
      messageId: String(message._id),
      userId: String(userId),
      isGroup: false,
    });

  return {
    success: true,
    messageId: String(message._id),
    viewOnceExpired: true,
  };
};

/**
 * Sweeper function for both direct and group messages that have expired.
 */
export const sweepAllDisappearingMessages = async () => {
  try {
    const now = new Date();

    // 1. Direct Messages
    const expiredDirect = await Message.find({
      expiresAt: { $lte: now },
      isDeleted: { $ne: true },
    }).limit(200);

    const updatedDirectConversations = new Map();

    for (const m of expiredDirect) {
      await wipeMessage(m);

      io.to(String(m.senderId))
        .to(String(m.receiverId))
        .emit("messageDeleted", { messageId: m._id });

      const u1 = String(m.senderId);
      const u2 = String(m.receiverId);
      const pairKey = u1 < u2 ? `${u1}:${u2}` : `${u2}:${u1}`;
      if (!updatedDirectConversations.has(pairKey)) {
        updatedDirectConversations.set(pairKey, [u1, u2]);
      }
    }

    for (const [u1, u2] of updatedDirectConversations.values()) {
      await Promise.allSettled([
        emitConversationUpdate(u1, u2),
        emitConversationUpdate(u2, u1),
      ]);
    }

    // 2. Group Messages
    const expiredGroup = await GroupMessage.find({
      expiresAt: { $lte: now },
      isDeleted: { $ne: true },
    }).limit(200);

    for (const gm of expiredGroup) {
      await Promise.allSettled(deleteMedia(gm));
      gm.isDeleted = true;
      gm.deletedAt = now;
      gm.text = "";
      gm.image = undefined;
      gm.file = undefined;
      gm.audio = undefined;
      gm.video = undefined;
      gm.location = undefined;
      await gm.save();

      const payload = {
        groupId: String(gm.groupId),
        messageId: String(gm._id),
      };

      const group = await Group.findById(gm.groupId);
      if (group) {
        broadcastGroupMessageDeleted(group, payload);
        await emitGroupConversation(group);
      }
    }

    return expiredDirect.length + expiredGroup.length;
  } catch (err) {
    console.error("[disappearing] sweep failed:", err?.message || err);
    return 0;
  }
};
