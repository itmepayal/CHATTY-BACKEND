import * as messageRepository from "../../repositories/message.repository.js";
import { assertValidId, escapeRegex } from "../../../../shared/utils/validators.js";
import {
  notExpired,
  REPLY_SELECT,
  formatMessage,
} from "../../utils/message-helpers.js";
import { canSendReadReceipt } from "../../../privacy/services/privacy.service.js";

export const getMessages = async (userId, otherId) => {
  assertValidId(otherId, "User ID");

  const [messages, canReceipt] = await Promise.all([
    messageRepository
      .find({
        $and: [
          {
            $or: [
              { senderId: userId, receiverId: otherId },
              { senderId: otherId, receiverId: userId },
            ],
          },
          notExpired(),
        ],
        deletedFor: { $ne: userId },
      })
      .sort({ createdAt: 1 })
      .populate("replyTo", REPLY_SELECT),
    canSendReadReceipt(userId, otherId),
  ]);

  return {
    messages: messages.map((m) => {
      const formatted = formatMessage(m);
      if (!canReceipt && formatted.status === "seen") {
        formatted.status = "delivered";
        formatted.seenAt = null;
      }
      return formatted;
    }),
    message: "User messages fetched successfully.",
  };
};

export const getPinned = async (userId, otherId) => {
  assertValidId(otherId, "user ID");

  const [pinned, canReceipt] = await Promise.all([
    messageRepository
      .find({
        $and: [
          {
            $or: [
              { senderId: userId, receiverId: otherId },
              { senderId: otherId, receiverId: userId },
            ],
          },
          notExpired(),
        ],
        isPinned: true,
        isDeleted: { $ne: true },
        deletedFor: { $ne: userId },
      })
      .sort({ pinnedAt: -1 })
      .populate("replyTo", REPLY_SELECT),
    canSendReadReceipt(userId, otherId),
  ]);

  return {
    pinned: pinned.map((m) => {
      const formatted = formatMessage(m);
      if (!canReceipt && formatted.status === "seen") {
        formatted.status = "delivered";
        formatted.seenAt = null;
      }
      return formatted;
    }),
    message: "Pinned messages.",
  };
};

export const searchMessages = async (
  userId,
  otherId,
  { q: rawQ, limit: rawLimit } = {},
) => {
  const q = String(rawQ || "").trim();
  const limit = Math.min(Number(rawLimit) || 30, 50);

  assertValidId(otherId, "user ID");

  if (q.length < 2) {
    return {
      results: [],
      message: "Type at least 2 characters.",
    };
  }

  const results = await messageRepository.find({
    $and: [
      {
        $or: [
          { senderId: userId, receiverId: otherId },
          { senderId: otherId, receiverId: userId },
        ],
      },
      notExpired(),
    ],
    deletedFor: { $ne: userId },
    isDeleted: { $ne: true },
    e2ee: { $ne: true },
    text: { $regex: escapeRegex(q), $options: "i" },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select("senderId receiverId text createdAt");

  return {
    results: results.map((m) => ({
      id: m._id,
      senderId: m.senderId,
      text: m.text,
      createdAt: m.createdAt,
    })),
    message: "Search results.",
  };
};

const messageQueryService = {
  getMessages,
  getPinned,
  searchMessages,
};

export default messageQueryService;

