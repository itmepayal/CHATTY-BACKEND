import Message from "../../models/message.model.js";
import { getExpiry } from "../../models/chat-setting.model.js";
import {
  io,
  isUserOnline,
  isUserViewingChat,
  getPrivacy,
} from "../../lib/socket.js";
import {
  formatMessage,
  emitConversationUpdate,
  REPLY_SELECT,
} from "../../utils/message-helpers.js";
import { assertValidId } from "../../utils/validators.js";
import { isBlockedEitherWay } from "../privacy/privacy.service.js";

/**
 * Moved from services/message.service.js:L27-72
 */
export const deliverMessage = async ({ senderId, receiverId, data }) => {
  const online = isUserOnline(receiverId);

  const [viewing, expiresAt] = await Promise.all([
    online ? isUserViewingChat(receiverId, senderId) : false,
    getExpiry(senderId, receiverId),
  ]);

  const canSendReceipt =
    getPrivacy(receiverId).readReceipts !== false &&
    getPrivacy(senderId).readReceipts !== false;
  const seenNow = viewing && canSendReceipt;
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

/**
 * Moved from messages.controller.js:L476-533
 */
export const markMessagesSeen = async (userId, otherUserId) => {
  assertValidId(otherUserId, "user ID");

  const blocked = await isBlockedEitherWay(userId, otherUserId);
  const canReceipt =
    !blocked &&
    getPrivacy(userId).readReceipts !== false &&
    getPrivacy(otherUserId).readReceipts !== false;

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

    if (canReceipt) {
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

  return {
    count: ids.length,
    message: "Messages marked as seen.",
  };
};
