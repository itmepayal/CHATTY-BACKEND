import Message from "../models/message.model.js";
import { getExpiry } from "../models/chatSetting.model.js";
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
} from "../utils/messageHelpers.js";

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
