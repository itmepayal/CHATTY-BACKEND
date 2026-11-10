/**
 * Message Spam Protection Service
 * Guards against message duplication floods and high-velocity new conversation spam.
 */

import { StatusCodes } from "http-status-codes";
import * as messageRepository from "../../repositories/message.repository.js";
import ApiError from "../../../../shared/errors/api-error.js";
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
    const dup = await messageRepository.countDocuments({
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

  const recentReceivers = await messageRepository.distinct("receiverId", {
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

const messageSpamService = {
  assertNotSpamming,
};

export default messageSpamService;
