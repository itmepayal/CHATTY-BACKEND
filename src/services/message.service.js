import Message from "../models/message.model.js";
import { getExpiry } from "../models/chat-setting.model.js";
import {
  io,
  isUserOnline,
  isUserViewingChat,
  getPrivacy,
} from "../lib/socket.js";
import {
  formatMessage,
  emitConversationUpdate,
  REPLY_SELECT,
} from "../utils/message-helpers.js";
import User from "../models/users.model.js";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import { uploadFileToCloudinary } from "../config/cloudinary.config.js";
import {
  SPAM_DUP_WINDOW_MS,
  SPAM_DUP_MAX,
  SPAM_NEW_CHAT_WINDOW_MS,
  SPAM_NEW_CHAT_MAX,
  MAX_VOICE_SECONDS,
  MAX_VIDEO_SECONDS,
} from "../constants/constants.js";

export const deliverMessage = async ({ senderId, receiverId, data }) => {
  const online = isUserOnline(receiverId);

  const [viewing, expiresAt] = await Promise.all([
    online ? isUserViewingChat(receiverId, senderId) : false,
    getExpiry(senderId, receiverId),
  ]);

  const seenNow = viewing && getPrivacy(receiverId).readReceipts;
  const now = new Date();

  const message = await Message.create({
    senderId,
    receiverId,
    ...data,
    expiresAt,
    status: seenNow ? "seen" : online ? "delivered" : "sent",
    deliveredAt: online ? now : undefined,
    seenAt: seenNow ? now : undefined,
    receiverReadAt: viewing ? now : undefined,
  });

  await message.populate("replyTo", REPLY_SELECT);
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

  return { message, payload };
};


export const assertE2EEReady = async (senderId, receiverId) => {
  const users = await User.find({
    _id: { $in: [senderId, receiverId] },
  }).select("+publicKey");

  const hasKey = (id) =>
    users.some((u) => String(u._id) === String(id) && Boolean(u.publicKey));

  if (!hasKey(senderId)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Set up encryption on your device first.",
    );
  }
  if (!hasKey(receiverId)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "This user hasn't enabled encryption yet.",
    );
  }
};

const SPAM = {
  DUP_WINDOW_MS: SPAM_DUP_WINDOW_MS,
  DUP_MAX: SPAM_DUP_MAX,
  NEW_CHAT_WINDOW_MS: SPAM_NEW_CHAT_WINDOW_MS,
  NEW_CHAT_MAX: SPAM_NEW_CHAT_MAX,
};

export const assertNotSpamming = async (senderId, receiverId, text) => {
  if (text) {
    const dup = await Message.countDocuments({
      senderId,
      receiverId,
      text,
      createdAt: { $gt: new Date(Date.now() - SPAM.DUP_WINDOW_MS) },
    });
    if (dup >= SPAM.DUP_MAX) {
      throw new ApiError(
        StatusCodes.TOO_MANY_REQUESTS,
        "Duplicate messages blocked. Please wait a bit.",
      );
    }
  }

  const recentReceivers = await Message.distinct("receiverId", {
    senderId,
    createdAt: { $gt: new Date(Date.now() - SPAM.NEW_CHAT_WINDOW_MS) },
  });
  const alreadyTalking = recentReceivers.some(
    (id) => id.toString() === receiverId.toString(),
  );
  if (!alreadyTalking && recentReceivers.length >= SPAM.NEW_CHAT_MAX) {
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      "You are messaging too many people too quickly.",
    );
  }
};




export const processAttachment = async (
  file,
  { isVoice = false, isVideo = false, duration } = {},
) => {
  if (!file?.path) {
    return { image: null, file: null, audio: null, video: null };
  }

  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload attachment.");
  }

  if (file.mimetype?.startsWith("image/")) {
    return {
      image: { url: up.secure_url, public_id: up.public_id },
      file: null,
      audio: null,
      video: null,
    };
  }

  if (isVoice && file.mimetype?.startsWith("audio/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      image: null,
      file: null,
      video: null,
      audio: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VOICE_SECONDS),
        mimeType: file.mimetype.split(";")[0],
        resourceType: up.resource_type,
      },
    };
  }

  if (isVideo && file.mimetype?.startsWith("video/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      image: null,
      file: null,
      audio: null,
      video: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VIDEO_SECONDS),
        mimeType: file.mimetype.split(";")[0],
        resourceType: up.resource_type,
      },
    };
  }

  return {
    image: null,
    audio: null,
    video: null,
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
