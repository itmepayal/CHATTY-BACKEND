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
import { getOrFetchPrivacy } from "../../../../infrastructure/socket/socket-state.js";
import User from "../../../users/models/users.model.js";
import Contact from "../../../contacts/models/contact.model.js";
import ApiError from "../../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";
import * as notificationService from "../../../notifications/services/notification.service.js";

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

  User.findByIdAndUpdate(senderId, { lastSeen: now }).catch(() => {});

  const message = await messageRepository.create({
    senderId,
    receiverId,
    ...data,
    expiresAt: data?.expiresAt || expiresAt,
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

  const receiverPrivacy = await getOrFetchPrivacy(receiverId);
  const isReceiverLocked = (receiverPrivacy?.lockedChats || []).includes(
    String(senderId),
  );

  if (isReceiverLocked) {
    const redactedPayload = {
      id: payload.id,
      _id: payload.id,
      senderId: payload.senderId,
      receiverId: payload.receiverId,
      isLocked: true,
      status: payload.status,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
    };
    io.to(receiverId.toString()).emit("newMessage", redactedPayload);
  } else {
    io.to(receiverId.toString()).emit("newMessage", payload);
  }

  if (senderId.toString() !== receiverId.toString()) {
    io.to(senderId.toString()).emit("newMessage", payload);
  }

  if (payload.gift?.name) {
    io.to(receiverId.toString()).emit("message:gift:received", payload);
    io.to(senderId.toString()).emit("message:gift:send", payload);
  }

  if (seenNow) {
    io.to(senderId.toString()).emit("messagesSeen", {
      messageIds: [message._id],
      seenBy: receiverId,
      seenAt: now,
    });
  }

  if (!viewing) {
    try {
      const senderUser = await User.findById(senderId).select("fullName username").lean();
      const senderName = senderUser?.fullName || senderUser?.username || "Someone";
      let notifType = "message_received";
      let title = senderName;
      let body = "New message";

      if (data?.replyTo) {
        notifType = "message_reply";
        title = `${senderName} replied to your message`;
      }

      if (data?.image?.url) {
        notifType = "media_received";
        body = "Sent a photo";
      } else if (data?.video?.url) {
        notifType = "media_received";
        body = "Sent a video";
      } else if (data?.audio?.url) {
        notifType = "media_received";
        body = "Sent a voice message";
      } else if (data?.file?.url) {
        notifType = "media_received";
        body = "Sent an attachment";
      } else if (data?.location?.lat != null) {
        notifType = "location_shared";
        body = "Shared live location";
      } else if (data?.gift?.name) {
        notifType = "gift_received";
        body = `Sent you a gift: ${data.gift.icon || "🎁"} ${data.gift.name}`;
      } else if (data?.e2ee || data?.encrypted) {
        body = "New encrypted message";
      } else if (data?.text) {
        body = data.text.length > 80 ? `${data.text.slice(0, 80)}…` : data.text;
      }

      notificationService.dispatchNotification({
        recipientId: receiverId,
        senderId,
        category: "message",
        type: notifType,
        title,
        body,
        data: {
          conversationId: String(senderId),
          peerId: String(senderId),
          messageId: String(message._id),
        },
      }).catch((e) => console.error("[deliverMessage] notification dispatch error:", e?.message));
    } catch (_err) {}
  }

  await Promise.all([
    emitConversationUpdate(receiverId, senderId),
    emitConversationUpdate(senderId, receiverId),
  ]);

  return { message, payload };
};

export const markMessagesSeen = async (userId, otherUserId) => {
  assertValidId(otherUserId, "user ID");

  const isMutual = await Contact.isMutualContact(userId, otherUserId);
  if (!isMutual) {
    const err = new ApiError(
      StatusCodes.FORBIDDEN,
      "You must become contacts before sending messages.",
    );
    err.code = "CONTACT_NOT_ACCEPTED";
    throw err;
  }

  const blocked = await isBlockedEitherWay(userId, otherUserId);
  const canReceipt =
    !blocked &&
    getPrivacy(userId).readReceipts !== false &&
    getPrivacy(otherUserId).readReceipts !== false;

  const unseen = await messageRepository
    .find({
      senderId: otherUserId,
      receiverId: userId,
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

      const seenPayload = {
        messageIds: ids,
        seenBy: userId,
        seenAt: now,
      };

      io.to(otherUserId.toString()).emit("messagesSeen", seenPayload);
      io.to(userId.toString()).emit("messagesSeen", seenPayload);
    } else {
      await messageRepository.updateMany(
        { _id: { $in: ids } },
        { $set: { receiverReadAt: now } },
      );
    }
  }

  await Promise.all([
    emitConversationUpdate(userId, otherUserId),
    emitConversationUpdate(otherUserId, userId),
  ]);

  return {
    count: ids.length,
    conversationId: otherUserId.toString(),
    unreadCount: 0,
    message: "Messages marked as seen.",
  };
};

const messageDeliveryService = {
  deliverMessage,
  markMessagesSeen,
};

export default messageDeliveryService;
