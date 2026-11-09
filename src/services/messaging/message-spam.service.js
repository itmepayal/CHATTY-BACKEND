import Message from "../../models/message.model.js";
import ApiError from "../../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import {
  SPAM_DUP_WINDOW_MS,
  SPAM_DUP_MAX,
  SPAM_NEW_CHAT_WINDOW_MS,
  SPAM_NEW_CHAT_MAX,
} from "../../constants/messages.constants.js";

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
