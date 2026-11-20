import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../shared/errors/api-error.js";
import * as messageRepository from "../../repositories/message.repository.js";
import { io } from "../../../../infrastructure/socket/socket.js";
import { assertValidId } from "../../../../shared/utils/validators.js";
import {
  isValidObjectId,
  toObjectId,
} from "../../../../shared/utils/object-id.util.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { assertE2EEReady } from "../core/message.service.js";
import {
  parseBool,
  assertValidCipher,
  MAX_CIPHERTEXT_LENGTH,
  sanitizeAndValidateEnvelopes,
} from "../../utils/e2ee.js";
import {
  EDIT_WINDOW_MS,
  MAX_PINS,
  MAX_TEXT_LENGTH,
} from "../../constants/messages.constants.js";
import { wipeMessage } from "../../utils/message-cleanup.js";
import { attachLinkPreview } from "../../../../shared/utils/link-preview.js";
import Message from "../../models/message.model.js";
import {
  emitConversationUpdate,
  isParticipantOf,
  getOtherUserId,
  emitToPair,
  isExpired,
  formatMessage,
  REPLY_SELECT,
} from "../../utils/message-helpers.js";
import * as notificationService from "../../../notifications/services/notification.service.js";

export const editMessage = async (
  userId,
  messageId,
  { text: rawText, encrypted, e2ee, iv, keyEnvelopes } = {},
) => {
  const text = rawText?.trim();
  const wantsE2EE = parseBool(encrypted ?? e2ee);

  assertValidId(messageId, "message ID");

  const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;
  if (!text || text.length > maxLen) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      wantsE2EE
        ? "Encrypted payload is invalid or too large."
        : `Text must be 1-${MAX_TEXT_LENGTH} characters.`,
    );
  }

  const message = await messageRepository.findById(messageId);
  if (!message || message.isDeleted || isExpired(message)) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }
  if (message.senderId.toString() !== userId.toString()) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only the sender can edit.");
  }
  if (message.audio?.url || message.video?.url) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Voice/video messages can't be edited.",
    );
  }
  if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Edit time is over.");
  }

  if (Boolean(message.e2ee) !== wantsE2EE) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Encryption mode of a message can't be changed.",
    );
  }
  if (wantsE2EE) {
    assertValidCipher(text, iv);
    if (!Array.isArray(keyEnvelopes) || keyEnvelopes.length === 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Key envelopes are required for encrypted message.",
      );
    }
  }

  await assertCanMessage(userId, message.receiverId);
  if (wantsE2EE) await assertE2EEReady(userId, message.receiverId);

  if (!wantsE2EE && message.text === text) {
    return {
      payload: { messageId: message._id },
      isNoop: true,
      message: "No changes.",
    };
  }

  let sanitizedEnvelopes = [];
  if (wantsE2EE) {
    sanitizedEnvelopes = sanitizeAndValidateEnvelopes(keyEnvelopes, {
      senderId: userId,
      receiverId: message.receiverId,
      requireReceiverEnvelope: true,
    });
  }

  message.text = text;
  if (wantsE2EE) {
    message.iv = iv;
    message.keyEnvelopes = sanitizedEnvelopes;
  }
  message.isEdited = true;
  message.editedAt = new Date();
  message.linkPreview = undefined;
  await message.save();

  const formattedEnvelopes = wantsE2EE
    ? (message.keyEnvelopes || []).map((env) => ({
        deviceId: String(env.deviceId),
        userId: String(env.userId),
        wrappedKey: env.wrappedKey,
        iv: env.iv,
      }))
    : [];

  const payload = {
    messageId: message._id,
    text,
    isEdited: true,
    editedAt: message.editedAt,
    ...(wantsE2EE
      ? {
          encrypted: true,
          iv: message.iv,
          keyEnvelopes: formattedEnvelopes,
        }
      : {
          encrypted: false,
        }),
  };

  emitToPair(message.receiverId, message.senderId, "messageEdited", payload);

  await Promise.all([
    emitConversationUpdate(message.receiverId, message.senderId),
    emitConversationUpdate(message.senderId, message.receiverId),
  ]);

  if (!wantsE2EE) attachLinkPreview(message);

  return { payload, isNoop: false, message: "Message edited." };
};

export const togglePin = async (userId, messageId) => {
  assertValidId(messageId, "message ID");

  const message = await messageRepository.findById(messageId);
  if (!message || message.isDeleted || isExpired(message)) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }
  if (!isParticipantOf(message, userId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You cannot pin this message.");
  }

  const otherId = getOtherUserId(message, userId);
  await assertCanMessage(userId, otherId);

  if (!message.isPinned) {
    const count = await messageRepository.countDocuments({
      isPinned: true,
      isDeleted: { $ne: true },
      deletedFor: { $ne: userId },
      $or: [
        { senderId: userId, receiverId: otherId },
        { senderId: otherId, receiverId: userId },
      ],
    });
    if (count >= MAX_PINS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `You can pin up to ${MAX_PINS} messages.`,
      );
    }
    message.isPinned = true;
    message.pinnedBy = userId;
    message.pinnedAt = new Date();
  } else {
    message.isPinned = false;
    message.pinnedBy = undefined;
    message.pinnedAt = undefined;
  }

  await message.save();

  const payload = {
    messageId: message._id,
    isPinned: message.isPinned,
    pinnedBy: userId,
  };

  emitToPair(userId, otherId, "messagePinned", payload);

  if (message.isPinned && String(otherId) !== String(userId)) {
    notificationService
      .dispatchNotification({
        recipientId: otherId,
        senderId: userId,
        category: "message",
        type: "message_pinned",
        title: "Message Pinned",
        body: "Pinned a message in your chat",
        data: {
          conversationId: String(userId),
          peerId: String(userId),
          messageId: String(message._id),
        },
      })
      .catch(() => {});
  }

  return { payload, message: "Pin updated." };
};

export const reactMessage = async (userId, messageId, rawEmoji) => {
  const emoji = rawEmoji;

  assertValidId(messageId, "message ID");

  if (!emoji || typeof emoji !== "string" || emoji.length > 16) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Valid emoji is required.");
  }

  const message = await messageRepository.findById(messageId);

  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }
  if (message.isDeleted || isExpired(message)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Cannot react to a deleted message.",
    );
  }
  if (!isParticipantOf(message, userId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You cannot react to this message.",
    );
  }

  await assertCanMessage(userId, getOtherUserId(message, userId));

  const existingIndex = message.reactions.findIndex(
    (r) => r.userId.toString() === userId.toString(),
  );

  if (existingIndex === -1) {
    message.reactions.push({ userId, emoji });
  } else if (message.reactions[existingIndex].emoji === emoji) {
    message.reactions.splice(existingIndex, 1);
  } else {
    message.reactions[existingIndex].emoji = emoji;
  }

  await message.save();

  const payload = {
    messageId: message._id,
    reactions: message.reactions.map((r) => ({
      userId: r.userId,
      emoji: r.emoji,
    })),
  };

  const otherUserId = getOtherUserId(message, userId);

  emitToPair(otherUserId, userId, "messageReaction", payload);

  if (existingIndex === -1 && String(message.senderId) !== String(userId)) {
    notificationService
      .dispatchNotification({
        recipientId: message.senderId,
        senderId: userId,
        category: "message",
        type: "message_reaction",
        title: "New Reaction",
        body: `Reacted ${emoji} to your message`,
        data: {
          conversationId: String(userId),
          peerId: String(userId),
          messageId: String(message._id),
          emoji,
        },
      })
      .catch(() => {});
  }

  return { payload, message: "Reaction updated successfully." };
};

export const deleteMessageForMe = async (userId, messageId) => {
  assertValidId(messageId, "message ID");

  const message = await messageRepository.findById(messageId);

  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }
  if (!isParticipantOf(message, userId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You cannot delete this message.",
    );
  }

  await messageRepository.updateOne(
    { _id: messageId },
    { $addToSet: { deletedFor: userId } },
  );

  io.to(userId.toString()).emit("messageDeletedForMe", {
    messageId: message._id,
  });

  await emitConversationUpdate(userId, getOtherUserId(message, userId));

  return { messageId: message._id, message: "Message deleted for you." };
};

export const deleteMessageForEveryone = async (userId, messageId) => {
  assertValidId(messageId, "message ID");

  const message = await messageRepository.findById(messageId);

  if (!message) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }
  if (message.senderId.toString() !== userId.toString()) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only the sender can delete a message for everyone.",
    );
  }
  if (message.isDeleted) {
    return {
      payload: { messageId: message._id },
      alreadyDeleted: true,
      message: "Message already deleted.",
    };
  }

  await wipeMessage(message);

  if (message.parentMessageId) {
    const updatedParent = await messageRepository.updateById(
      message.parentMessageId,
      { $inc: { threadReplyCount: -1 } },
      { new: true },
    );
    const count = Math.max(0, updatedParent?.threadReplyCount || 0);
    io.to(String(message.receiverId))
      .to(String(message.senderId))
      .emit("threadUpdated", {
        parentMessageId: String(message.parentMessageId),
        threadReplyCount: count,
      });
    io.to(String(message.receiverId))
      .to(String(message.senderId))
      .emit("threadReplyDeleted", {
        parentMessageId: String(message.parentMessageId),
        replyId: String(message._id),
      });
  }

  const payload = { messageId: message._id };

  emitToPair(message.receiverId, message.senderId, "messageDeleted", payload);

  await Promise.all([
    emitConversationUpdate(message.receiverId, message.senderId),
    emitConversationUpdate(message.senderId, message.receiverId),
  ]);

  return {
    payload,
    alreadyDeleted: false,
    message: "Message deleted for everyone.",
  };
};

export const toggleStar = async (userId, messageId) => {
  assertValidId(messageId, "message ID");

  const message = await messageRepository.findById(messageId);
  if (!message || message.isDeleted || isExpired(message)) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
  }
  if (!isParticipantOf(message, userId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You cannot star this message.");
  }

  const uIdStr = String(userId);
  const starredBy = Array.isArray(message.starredBy) ? message.starredBy : [];
  const idx = starredBy.findIndex((id) => String(id) === uIdStr);
  let isStarred = false;

  if (idx === -1) {
    message.starredBy.push(userId);
    isStarred = true;
  } else {
    message.starredBy.splice(idx, 1);
    isStarred = false;
  }

  await message.save();

  const payload = {
    messageId: String(message._id),
    isStarred,
    userId: uIdStr,
  };

  io.to(uIdStr).emit("messageStarred", payload);

  return {
    payload,
    message: isStarred ? "Message starred." : "Message unstarred.",
  };
};

export const getStarredMessages = async (userId, chatUserId) => {
  assertValidId(userId, "user ID");
  const query = {
    starredBy: toObjectId(userId),
    isDeleted: { $ne: true },
    deletedFor: { $ne: toObjectId(userId) },
  };

  if (chatUserId && isValidObjectId(chatUserId)) {
    const cId = toObjectId(chatUserId);
    const uId = toObjectId(userId);
    query.$or = [
      { senderId: uId, receiverId: cId },
      { senderId: cId, receiverId: uId },
    ];
  }

  const messages = await Message.find(query)
    .populate("replyTo", REPLY_SELECT)
    .sort({ createdAt: -1 })
    .lean();

  return messages.map(formatMessage);
};

const messageLifecycleService = {
  editMessage,
  togglePin,
  toggleStar,
  getStarredMessages,
  reactMessage,
  deleteMessageForMe,
  deleteMessageForEveryone,
};

export default messageLifecycleService;
