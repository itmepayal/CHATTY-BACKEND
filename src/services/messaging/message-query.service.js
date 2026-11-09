import Message from "../../models/message.model.js";
import { assertValidId, escapeRegex } from "../../utils/validators.js";
import {
  notExpired,
  REPLY_SELECT,
  formatMessage,
} from "../../utils/message-helpers.js";

/**
 * Moved from messages.controller.js:L258-284
 */
export const getMessages = async (userId, otherId) => {
  assertValidId(otherId, "User ID");

  const messages = await Message.find({
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
    .populate("replyTo", REPLY_SELECT);

  return {
    messages: messages.map(formatMessage),
    message: "User messages fetched successfully.",
  };
};

/**
 * Moved from messages.controller.js:L666-694
 */
export const getPinned = async (userId, otherId) => {
  assertValidId(otherId, "user ID");

  const pinned = await Message.find({
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
    .populate("replyTo", REPLY_SELECT);

  return {
    pinned: pinned.map(formatMessage),
    message: "Pinned messages.",
  };
};

/**
 * Moved from messages.controller.js:L696-741
 */
export const searchMessages = async (userId, otherId, { q: rawQ, limit: rawLimit } = {}) => {
  const q = String(rawQ || "").trim();
  const limit = Math.min(Number(rawLimit) || 30, 50);

  assertValidId(otherId, "user ID");

  if (q.length < 2) {
    return {
      results: [],
      message: "Type at least 2 characters.",
    };
  }

  const results = await Message.find({
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
