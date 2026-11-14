import * as messageRepository from "../../repositories/message.repository.js";
import { getExpiry } from "../../repositories/chat-setting.repository.js";
import {
  io,
  isUserOnline,
  isUserViewingChat,
  getPrivacy,
} from "../../../../infrastructure/socket/socket.js";
import {
  formatMessage,
  emitConversationUpdate,
  REPLY_SELECT,
} from "../../utils/message-helpers.js";
import { assertValidId } from "../../../../shared/utils/validators.js";
import { isBlockedEitherWay } from "../../../privacy/services/privacy.service.js";

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

  const message = await messageRepository.create({
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

  console.log(
    `[delivery] message ${message._id} saved (status: ${message.status}). Broadcasting to receiver ${receiverId} and sender ${senderId}`,
  );

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

export const markMessagesSeen = async (userId, otherUserId) => {
  assertValidId(otherUserId, "user ID");

  const blocked = await isBlockedEitherWay(userId, otherUserId);
  const canReceipt =
    !blocked &&
    getPrivacy(userId).readReceipts !== false &&
    getPrivacy(otherUserId).readReceipts !== false;

  const unseen = await messageRepository
    .find({
      senderId: otherUserId,
      receiverId: userId,
      status: { $ne: "seen" },
      receiverReadAt: null,
      isDeleted: { $ne: true },
    })
    .select("_id");

  const ids = unseen.map((m) => m._id);

  if (ids.length) {
    const now = new Date();
    console.log(
      `[delivery] markMessagesSeen: user ${userId} marked ${ids.length} messages from ${otherUserId} as seen`,
    );

    if (canReceipt) {
      await messageRepository.updateMany({ _id: { $in: ids } }, [
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
      await messageRepository.updateMany(
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

const messageDeliveryService = {
  deliverMessage,
  markMessagesSeen,
};

export default messageDeliveryService;
