import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import mongoose from "mongoose";
import ApiError from "../utils/apiError.js";
import { StatusCodes } from "http-status-codes";
import User from "../models/users.model.js";
import Message from "../models/message.model.js";
import ApiResponse from "../utils/apiResponse.js";
import {
  uploadFileToCloudinary,
  deleteFileToCloudinary,
} from "../config/cloudinary.config.js";
import {
  io,
  isUserOnline,
  isUserViewingChat,
  getPrivacy,
} from "../lib/socket.js";
import { assertCanMessage } from "../utils/chatguard.js";

const MAX_VOICE_SECONDS = 300;

const toObjectId = (id) => new mongoose.Types.ObjectId(id);

const formatFile = (file) =>
  file?.url
    ? {
        url: file.url,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
      }
    : null;

const formatAudio = (audio) =>
  audio?.url
    ? {
        url: audio.url,
        duration: audio.duration || 0,
        mimeType: audio.mimeType,
      }
    : null;

const formatMessage = (msg) => {
  const deleted = Boolean(msg.isDeleted);

  return {
    id: msg._id,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    text: deleted ? "" : msg.text,
    image:
      !deleted && msg.image?.url
        ? { url: msg.image.url, public_id: msg.image.public_id }
        : null,
    file: deleted ? null : formatFile(msg.file),
    audio: deleted ? null : formatAudio(msg.audio),
    clientId: msg.clientId,
    reactions: deleted
      ? []
      : (msg.reactions || []).map((r) => ({
          userId: r.userId,
          emoji: r.emoji,
        })),
    isDeleted: deleted,
    status: msg.status || "sent",
    deliveredAt: msg.deliveredAt,
    seenAt: msg.seenAt,
    createdAt: msg.createdAt,
  };
};

const processAttachment = async (file, { isVoice = false, duration } = {}) => {
  if (!file?.path) return { image: null, file: null, audio: null };

  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload attachment.");
  }

  if (file.mimetype?.startsWith("image/")) {
    return {
      image: { url: up.secure_url, public_id: up.public_id },
      file: null,
      audio: null,
    };
  }

  if (isVoice && file.mimetype?.startsWith("audio/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      image: null,
      file: null,
      audio: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VOICE_SECONDS),
        mimeType: file.mimetype.split(";")[0],
        resourceType: up.resource_type,
      },
    };
  }

  return {
    image: null,
    audio: null,
    file: {
      public_id: up.public_id,
      url: up.secure_url,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      resourceType: up.resource_type,
    },
  };
};

const isParticipantOf = (message, userId) =>
  message.senderId.toString() === userId.toString() ||
  message.receiverId.toString() === userId.toString();

const getOtherUserId = (message, userId) =>
  message.senderId.toString() === userId.toString()
    ? message.receiverId
    : message.senderId;

const unreadFilter = (receiverId, senderId) => ({
  receiverId: toObjectId(receiverId),
  senderId: toObjectId(senderId),
  status: { $ne: "seen" },
  receiverReadAt: null,
  isDeleted: { $ne: true },
  deletedFor: { $ne: toObjectId(receiverId) },
});

const getUnreadCount = (receiverId, senderId) =>
  Message.countDocuments(unreadFilter(receiverId, senderId));

const getLastMessage = async (ownerId, otherId) => {
  const owner = toObjectId(ownerId);
  const other = toObjectId(otherId);

  const msg = await Message.findOne({
    $or: [
      { senderId: owner, receiverId: other },
      { senderId: other, receiverId: owner },
    ],
    deletedFor: { $ne: owner },
  }).sort({ createdAt: -1 });

  return msg ? formatMessage(msg) : null;
};

const emitConversationUpdate = async (ownerId, otherId) => {
  try {
    const ts = Date.now();
    const [unreadCount, lastMessage] = await Promise.all([
      getUnreadCount(ownerId, otherId),
      getLastMessage(ownerId, otherId),
    ]);

    io.to(ownerId.toString()).emit("conversationUpdated", {
      userId: otherId.toString(),
      unreadCount,
      lastMessage,
      lastMessageAt: lastMessage?.createdAt ?? null,
      ts,
    });
  } catch (err) {
    console.error("emitConversationUpdate failed:", err?.message || err);
  }
};

const messageController = {
  getUsersForSidebar: asyncHandler(async (req, res) => {
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid User ID.");
    }

    const uid = toObjectId(userId);

    const [users, me] = await Promise.all([
      User.find({ _id: { $ne: userId } }).select("fullName email avatar"),
      User.findById(userId).select("blockedUsers"),
    ]);

    const blockedSet = new Set((me?.blockedUsers || []).map(String));

    const convoAgg = await Message.aggregate([
      {
        $match: {
          $or: [{ senderId: uid }, { receiverId: uid }],
          deletedFor: { $ne: uid },
        },
      },
      {
        $addFields: {
          otherId: {
            $cond: [{ $eq: ["$senderId", uid] }, "$receiverId", "$senderId"],
          },
          isUnread: {
            $and: [
              { $eq: ["$receiverId", uid] },
              { $ne: ["$status", "seen"] },
              { $eq: [{ $ifNull: ["$receiverReadAt", null] }, null] },
              { $ne: ["$isDeleted", true] },
            ],
          },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$otherId",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: { $sum: { $cond: ["$isUnread", 1, 0] } },
        },
      },
    ]);

    const convoMap = new Map(convoAgg.map((c) => [c._id.toString(), c]));
    const ts = Date.now();

    const response = users
      .map((user) => {
        const c = convoMap.get(user._id.toString());
        const isBlocked = blockedSet.has(user._id.toString());
        return {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          avatar: user.avatar?.url || "",
          isBlocked,
          unreadCount: isBlocked ? 0 : c?.unreadCount || 0,
          lastMessage: c ? formatMessage(c.lastMessage) : null,
          lastMessageAt: c?.lastMessage.createdAt || null,
          ts,
        };
      })
      .sort((a, b) => {
        const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bt - at;
      });

    return new ApiResponse(
      StatusCodes.OK,
      response,
      "Users fetched successfully.",
    ).send(res);
  }),

  getMessage: asyncHandler(async (req, res) => {
    const { id: userToChatId } = req.params;
    const senderId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(userToChatId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid User ID.");
    }

    const messages = await Message.find({
      $or: [
        { senderId: senderId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: senderId },
      ],
      deletedFor: { $ne: senderId },
    }).sort({ createdAt: 1 });

    return new ApiResponse(
      StatusCodes.OK,
      messages.map(formatMessage),
      "User messages fetched successfully.",
    ).send(res);
  }),

  sendMessage: asyncHandler(async (req, res) => {
    const { text, clientId, isVoice, duration } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid receiver ID.");
    }

    if (receiverId.toString() === senderId.toString()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You cannot send a message to yourself.",
      );
    }

    const trimmedText = text?.trim();

    if (!trimmedText && !req.file) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
    }

    if (clientId) {
      const existing = await Message.findOne({ senderId, clientId });
      if (existing) {
        return new ApiResponse(
          StatusCodes.OK,
          formatMessage(existing),
          "Message already sent.",
        ).send(res);
      }
    }

    await assertCanMessage(senderId, receiverId);

    const {
      image: uploadedImage,
      file: uploadedFile,
      audio: uploadedAudio,
    } = await processAttachment(req.file, {
      isVoice: isVoice === "true" || isVoice === true,
      duration,
    });

    const online = isUserOnline(receiverId);
    const viewing = online && (await isUserViewingChat(receiverId, senderId));
    const seenNow = viewing && getPrivacy(receiverId).readReceipts;
    const now = new Date();

    let message;
    try {
      message = await Message.create({
        senderId,
        receiverId,
        text: trimmedText,
        clientId: clientId || undefined,
        image: uploadedImage || undefined,
        file: uploadedFile || undefined,
        audio: uploadedAudio || undefined, // NEW
        status: seenNow ? "seen" : online ? "delivered" : "sent",
        deliveredAt: online ? now : undefined,
        seenAt: seenNow ? now : undefined,
        receiverReadAt: viewing ? now : undefined,
      });
    } catch (error) {
      if (error?.code === 11000 && clientId) {
        const existing = await Message.findOne({ senderId, clientId });
        if (existing) {
          return new ApiResponse(
            StatusCodes.OK,
            formatMessage(existing),
            "Message already sent.",
          ).send(res);
        }
      }
      throw error;
    }

    if (!message) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to send message.");
    }

    const payload = formatMessage(message);

    io.to(receiverId.toString()).emit("newMessage", payload);
    io.to(senderId.toString()).emit("newMessage", payload);

    if (seenNow) {
      io.to(senderId.toString()).emit("messagesSeen", {
        messageIds: [message._id],
        seenBy: receiverId,
        seenAt: now,
      });
    }

    await Promise.all([
      emitConversationUpdate(receiverId, senderId),
      emitConversationUpdate(senderId, receiverId),
    ]);

    return new ApiResponse(
      StatusCodes.CREATED,
      payload,
      "Message sent successfully.",
    ).send(res);
  }),

  markMessagesSeen: asyncHandler(async (req, res) => {
    const { id: otherUserId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
    }

    const { readReceipts } = getPrivacy(userId);

    const unseen = await Message.find({
      senderId: otherUserId,
      receiverId: userId,
      status: { $ne: "seen" },
      receiverReadAt: null,
      isDeleted: { $ne: true },
    }).select("_id");

    const ids = unseen.map((m) => m._id);

    if (ids.length) {
      const now = new Date();

      if (readReceipts) {
        await Message.updateMany({ _id: { $in: ids } }, [
          {
            $set: {
              status: "seen",
              seenAt: now,
              receiverReadAt: now,
              deliveredAt: { $ifNull: ["$deliveredAt", now] },
            },
          },
        ]);

        io.to(otherUserId.toString()).emit("messagesSeen", {
          messageIds: ids,
          seenBy: userId,
          seenAt: now,
        });
      } else {
        await Message.updateMany(
          { _id: { $in: ids } },
          { $set: { receiverReadAt: now } },
        );
      }
    }

    await emitConversationUpdate(userId, otherUserId);

    return new ApiResponse(
      StatusCodes.OK,
      { count: ids.length },
      "Messages marked as seen.",
    ).send(res);
  }),

  reactMessage: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid message ID.");
    }

    if (!emoji || typeof emoji !== "string" || emoji.length > 16) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Valid emoji is required.");
    }

    const message = await Message.findById(messageId);

    if (!message) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }

    if (message.isDeleted) {
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

    io.to(otherUserId.toString()).emit("messageReaction", payload);
    io.to(userId.toString()).emit("messageReaction", payload);

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      "Reaction updated successfully.",
    ).send(res);
  }),

  deleteMessageForMe: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid message ID.");
    }

    const message = await Message.findById(messageId);

    if (!message) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }

    if (!isParticipantOf(message, userId)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You cannot delete this message.",
      );
    }

    await Message.updateOne(
      { _id: messageId },
      { $addToSet: { deletedFor: userId } },
    );

    io.to(userId.toString()).emit("messageDeletedForMe", {
      messageId: message._id,
    });

    await emitConversationUpdate(userId, getOtherUserId(message, userId));

    return new ApiResponse(
      StatusCodes.OK,
      { messageId: message._id },
      "Message deleted for you.",
    ).send(res);
  }),

  deleteMessageForEveryone: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid message ID.");
    }

    const message = await Message.findById(messageId);

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
      return new ApiResponse(
        StatusCodes.OK,
        { messageId: message._id },
        "Message already deleted.",
      ).send(res);
    }

    const imageId = message.image?.public_id;
    if (imageId) {
      try {
        await deleteFileToCloudinary(imageId, "image");
      } catch (err) {
        console.error("Cloudinary image delete failed:", err?.message || err);
      }
    }

    const fileId = message.file?.public_id;
    if (fileId) {
      try {
        await deleteFileToCloudinary(
          fileId,
          message.file.resourceType || "raw",
        );
      } catch (err) {
        console.error("Cloudinary file delete failed:", err?.message || err);
      }
    }

    const audioId = message.audio?.public_id;
    if (audioId) {
      try {
        await deleteFileToCloudinary(
          audioId,
          message.audio.resourceType || "video",
        );
      } catch (err) {
        console.error("Cloudinary audio delete failed:", err?.message || err);
      }
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.text = undefined;
    message.image = undefined;
    message.file = undefined;
    message.audio = undefined;
    message.reactions = [];
    await message.save();

    const payload = { messageId: message._id };

    io.to(message.receiverId.toString()).emit("messageDeleted", payload);
    io.to(message.senderId.toString()).emit("messageDeleted", payload);

    await Promise.all([
      emitConversationUpdate(message.receiverId, message.senderId),
      emitConversationUpdate(message.senderId, message.receiverId),
    ]);

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      "Message deleted for everyone.",
    ).send(res);
  }),
};

export default messageController;
