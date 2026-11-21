import mongoose from "mongoose";
import Gift from "../models/gift.model.js";
import Wallet from "../models/wallet.model.js";
import Transaction from "../models/transaction.model.js";
import UserGift from "../models/user-gift.model.js";
import User from "../../users/models/users.model.js";
import Group from "../../groups/models/group.model.js";
import { sendMessage as sendMessageService } from "../../messaging/services/sending/message-send.service.js";
import { sendGroupMessageService } from "../../groups/services/group-message.service.js";
import * as walletService from "./wallet.service.js";
import { io } from "../../../infrastructure/socket/socket.js";
import * as notificationService from "../../notifications/services/notification.service.js";
import ApiError from "../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";

/**
 * Executes an atomic, safe virtual gift transaction across 1:1 or group chats.
 */
export const sendGift = async ({
  senderId,
  recipientId = null,
  groupId = null,
  giftIdOrSlug,
  personalMessage = "",
  idempotencyKey = null,
  chatType = "direct",
}) => {
  if (!senderId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Authentication required.");
  }

  // 1. Resolve authoritative Gift from database
  let gift = null;
  if (/^[0-9a-fA-F]{24}$/.test(String(giftIdOrSlug))) {
    gift = await Gift.findById(giftIdOrSlug).lean();
  }
  if (!gift) {
    gift = await Gift.findOne({ slug: String(giftIdOrSlug).toLowerCase() }).lean();
  }

  if (!gift || !gift.isActive) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "The selected gift is currently unavailable or inactive.",
    );
  }

  const sender = await User.findById(senderId).select("fullName username avatar").lean();
  if (!sender) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Sender account not found.");
  }

  // 2. Idempotency protection check
  if (idempotencyKey) {
    const existingTx = await Transaction.findOne({ idempotencyKey }).lean();
    if (existingTx) {
      const senderWallet = await walletService.getOrCreateWallet(senderId);
      return {
        isDuplicate: true,
        message: "Gift already processed.",
        transaction: existingTx,
        wallet: senderWallet,
      };
    }
  }

  // 3. Validate Chat Type & Target
  let groupDoc = null;
  let recipient = null;

  if (chatType === "group" || groupId) {
    chatType = "group";
    if (!groupId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Group ID is required for group gift.");
    }
    groupDoc = await Group.findById(groupId);
    if (!groupDoc) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Group not found.");
    }
    const isMember = groupDoc.members.some(
      (m) => String(m.userId?._id || m.userId) === String(senderId),
    );
    if (!isMember) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You are not a member of this group.",
      );
    }
  } else {
    chatType = "direct";
    if (!recipientId) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Recipient ID is required for direct gift.",
      );
    }
    if (String(recipientId) === String(senderId)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You cannot send a gift to yourself.",
      );
    }
    recipient = await User.findById(recipientId)
      .select("fullName username avatar blockedUsers")
      .lean();
    if (!recipient) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Recipient not found.");
    }

    const isBlocked =
      (recipient.blockedUsers || []).map(String).includes(String(senderId)) ||
      (sender.blockedUsers || []).map(String).includes(String(recipientId));
    if (isBlocked) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Unable to send gift to this contact.",
      );
    }
  }

  // 4. Atomic Balance Deduction on Sender Wallet
  const updatedSenderWallet = await walletService.deductCoins({
    userId: senderId,
    amount: gift.coinPrice,
  });

  // 5. Credit Recipient Wallet (if 1:1 direct)
  if (recipientId) {
    await walletService.creditCoins({
      userId: recipientId,
      amount: gift.coinPrice,
      type: "gift_received",
      metadata: {
        giftId: String(gift._id),
        giftName: gift.name,
        senderId: String(senderId),
      },
    });
  }

  // 6. Record Transaction for Sender
  const tx = await Transaction.create({
    userId: senderId,
    type: "gift_sent",
    amount: gift.coinPrice,
    balanceAfter: updatedSenderWallet.balance,
    giftId: gift._id,
    giftName: gift.name,
    giftIcon: gift.icon,
    giftImage: gift.image,
    senderId,
    recipientId: recipientId || undefined,
    chatType,
    targetId: String(groupId || recipientId),
    idempotencyKey: idempotencyKey || undefined,
    metadata: {
      category: gift.category,
      rarity: gift.rarity,
      personalMessage,
    },
  });

  // 7. Record in UserGift Collection
  let userGiftDoc = null;
  if (chatType === "direct" && recipientId) {
    userGiftDoc = await UserGift.create({
      recipientId,
      senderId,
      giftId: gift._id,
      gift: {
        id: String(gift._id),
        name: gift.name,
        slug: gift.slug,
        icon: gift.icon,
        image: gift.image,
        category: gift.category,
        coinPrice: gift.coinPrice,
        rarity: gift.rarity,
      },
      personalMessage: personalMessage ? personalMessage.slice(0, 160) : "",
      chatType,
      targetId: String(recipientId),
    });
  } else if (chatType === "group" && groupDoc) {
    const otherMembers = (groupDoc.members || [])
      .map((m) => (m.userId ? (m.userId._id || m.userId) : (m.user ? m.user._id || m.user : (m._id ? m._id : m))))
      .filter((uid) => uid && String(uid) !== String(senderId));

    if (otherMembers.length > 0) {
      const records = otherMembers.map((uid) => ({
        recipientId: uid,
        senderId,
        giftId: gift._id,
        gift: {
          id: String(gift._id),
          name: gift.name,
          slug: gift.slug,
          icon: gift.icon,
          image: gift.image,
          category: gift.category,
          coinPrice: gift.coinPrice,
          rarity: gift.rarity,
        },
        personalMessage: personalMessage ? personalMessage.slice(0, 160) : "",
        chatType,
        targetId: String(groupId),
      }));
      const docs = await UserGift.insertMany(records);
      userGiftDoc = docs[0];
    }
  }

  // 8. Package Standard Gift Payload for Chat Messages
  const giftPayload = {
    id: String(gift._id),
    giftId: String(gift._id),
    name: gift.name,
    slug: gift.slug,
    icon: gift.icon,
    image: gift.image,
    category: gift.category,
    coinPrice: gift.coinPrice,
    rarity: gift.rarity,
    badge: gift.badge || gift.rarity.toUpperCase(),
    color: gift.color,
    gradient: gift.gradient,
    animation: gift.animationAsset || (gift.isAnimated ? "animated" : ""),
    isAnimated: Boolean(gift.isAnimated),
    message: personalMessage ? personalMessage.slice(0, 160) : "",
    senderName: sender.fullName || "Someone",
    senderId: String(senderId),
  };

  // 9. Dispatch Message through the existing messaging pipeline
  let messageResult = null;
  if (chatType === "direct") {
    messageResult = await sendMessageService(
      senderId,
      recipientId,
      {
        text: personalMessage || "",
        gift: giftPayload,
      },
      null,
    );
  } else {
    messageResult = await sendGroupMessageService({
      group: groupDoc,
      me: senderId,
      text: personalMessage || "",
      body: {
        gift: JSON.stringify(giftPayload),
      },
      file: null,
    });
  }

  const messagePayload = messageResult?.payload || messageResult;

  // 10. Real-time Socket.IO Broadcasts & Wallet Synchronization
  io.to(String(senderId)).emit("gift:wallet:updated", {
    balance: updatedSenderWallet.balance,
    totalSpent: updatedSenderWallet.totalSpent,
    totalReceived: updatedSenderWallet.totalReceived,
  });

  if (recipientId) {
    io.to(String(recipientId)).emit("message:gift:received", {
      gift: giftPayload,
      message: messagePayload,
      sender: {
        id: String(sender._id),
        fullName: sender.fullName,
        username: sender.username,
        avatar: sender.avatar?.url || "",
      },
    });

    // Persistent and Push Notification
    notificationService
      .dispatchNotification({
        recipientId,
        senderId,
        category: "message",
        type: "gift_received",
        title: `${sender.fullName || "Someone"} sent you a gift!`,
        body: `${gift.icon || "🎁"} ${gift.name}${personalMessage ? `: "${personalMessage}"` : ""}`,
        data: {
          giftId: String(gift._id),
          giftName: gift.name,
          giftIcon: gift.icon,
          coinPrice: gift.coinPrice,
          senderId: String(senderId),
          senderName: sender.fullName,
          messageId: String(messagePayload?._id || messagePayload?.id || ""),
        },
      })
      .catch(() => {});
  }

  return {
    success: true,
    gift: giftPayload,
    wallet: {
      balance: updatedSenderWallet.balance,
      totalSpent: updatedSenderWallet.totalSpent,
      totalReceived: updatedSenderWallet.totalReceived,
    },
    senderBalance: updatedSenderWallet.balance,
    transaction: tx,
    message: messagePayload,
    userGift: userGiftDoc,
    isGroup: chatType === "group",
  };
};

/**
 * Retrieves the gifts received by a user.
 */
export const getReceivedGifts = async (userId, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    UserGift.find({ recipientId: userId })
      .populate("senderId", "fullName username avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserGift.countDocuments({ recipientId: userId }),
  ]);

  return {
    items: items.map((ug) => ({
      id: String(ug._id),
      _id: String(ug._id),
      gift: ug.gift,
      personalMessage: ug.personalMessage,
      chatType: ug.chatType,
      isPinnedToProfile: Boolean(ug.isPinnedToProfile),
      sender: ug.senderId
        ? {
            id: String(ug.senderId._id),
            _id: String(ug.senderId._id),
            fullName: ug.senderId.fullName,
            username: ug.senderId.username,
            avatar: ug.senderId.avatar?.url || "",
          }
        : null,
      createdAt: ug.createdAt,
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
};

/**
 * Retrieves the gifts sent by a user.
 */
export const getSentGifts = async (userId, query = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    UserGift.find({ senderId: userId })
      .populate("recipientId", "fullName username avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    UserGift.countDocuments({ senderId: userId }),
  ]);

  return {
    items: items.map((ug) => ({
      id: String(ug._id),
      _id: String(ug._id),
      gift: ug.gift,
      personalMessage: ug.personalMessage,
      chatType: ug.chatType,
      recipient: ug.recipientId
        ? {
            id: String(ug.recipientId._id),
            _id: String(ug.recipientId._id),
            fullName: ug.recipientId.fullName,
            username: ug.recipientId.username,
            avatar: ug.recipientId.avatar?.url || "",
          }
        : null,
      createdAt: ug.createdAt,
    })),
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
};

/**
 * Public/friend profile gift showcase.
 */
export const getUserGiftCollection = async (userId) => {
  const [totalCount, featured, recent] = await Promise.all([
    UserGift.countDocuments({ recipientId: userId, isPrivate: false }),
    UserGift.find({ recipientId: userId, isPinnedToProfile: true })
      .populate("senderId", "fullName username avatar")
      .limit(6)
      .lean(),
    UserGift.find({ recipientId: userId, isPrivate: false })
      .populate("senderId", "fullName username avatar")
      .sort({ createdAt: -1 })
      .limit(12)
      .lean(),
  ]);

  return {
    totalReceived: totalCount,
    pinnedGifts: featured.map((f) => ({
      id: String(f._id),
      gift: f.gift,
      personalMessage: f.personalMessage,
      sender: f.senderId ? { fullName: f.senderId.fullName } : null,
      createdAt: f.createdAt,
    })),
    recentGifts: recent.map((r) => ({
      id: String(r._id),
      gift: r.gift,
      personalMessage: r.personalMessage,
      sender: r.senderId ? { fullName: r.senderId.fullName } : null,
      createdAt: r.createdAt,
    })),
  };
};
