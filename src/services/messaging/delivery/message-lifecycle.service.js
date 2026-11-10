import { StatusCodes } from "http-status-codes";
import ApiError from "../../../utils/api-error.js";
import * as messageRepository from "../../../repositories/messaging/message.repository.js";
import { io } from "../../../lib/socket.js";
import { assertValidId } from "../../../utils/validators.js";
import { assertCanMessage } from "../../../utils/chat-guard.js";
import { assertE2EEReady } from "../core/message.service.js";
import {
  parseBool,
  assertValidCipher,
  MAX_CIPHERTEXT_LENGTH,
} from "../../../utils/e2ee.js";
import {
  EDIT_WINDOW_MS,
  MAX_PINS,
  MAX_TEXT_LENGTH,
} from "../../../constants/messages.constants.js";
import { wipeMessage } from "../../../utils/message-cleanup.js";
import { attachLinkPreview } from "../../../utils/link-preview.js";
import {
  emitConversationUpdate,
  isParticipantOf,
  getOtherUserId,
  emitToPair,
  isExpired,
} from "../../../utils/message-helpers.js";

export const editMessage = async (
  userId,
  messageId,
  { text: rawText, encrypted, e2ee, iv } = {},
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
  if (wantsE2EE) assertValidCipher(text, iv);

  await assertCanMessage(userId, message.receiverId);
  if (wantsE2EE) await assertE2EEReady(userId, message.receiverId);

  if (!wantsE2EE && message.text === text) {
    return {
      payload: { messageId: message._id },
      isNoop: true,
      message: "No changes.",
    };
  }

  message.text = text;
  if (wantsE2EE) message.iv = iv;
  message.isEdited = true;
  message.editedAt = new Date();
  message.linkPreview = undefined;
  await message.save();

  const payload = {
    messageId: message._id,
    text,
    isEdited: true,
    editedAt: message.editedAt,
    ...(wantsE2EE ? { encrypted: true, iv } : {}),
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

const messageLifecycleService = {
  editMessage,
  togglePin,
  reactMessage,
  deleteMessageForMe,
  deleteMessageForEveryone,
};

export default messageLifecycleService;

