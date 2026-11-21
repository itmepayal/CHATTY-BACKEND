import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../shared/errors/api-error.js";
import Message from "../../models/message.model.js";
import GroupMessage from "../../../groups/models/group-message.model.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { getGroupAndMember } from "../../../groups/helpers/group.member.helpers.js";
import { io } from "../../../../infrastructure/socket/socket.js";
import * as notificationService from "../../../notifications/services/notification.service.js";
import {
  assertValidObjectId,
  toObjectId,
} from "../../../../shared/utils/object-id.util.js";
import { formatMessage } from "../../utils/message-helpers.js";
import { formatGroupMessage } from "../../../groups/services/group.service.js";

export const getThread = async ({
  userId,
  parentMessageId,
  isGroup = false,
  groupId = null,
  page = 1,
  limit = 50,
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(parentMessageId, "Invalid parent message ID.");

  const pId = toObjectId(parentMessageId);
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (p - 1) * l;

  if (isGroup) {
    if (!groupId)
      throw new ApiError(StatusCodes.BAD_REQUEST, "Group ID is required.");
    await getGroupAndMember(groupId, userId);

    const parent = await GroupMessage.findOne({
      _id: pId,
      groupId: toObjectId(groupId),
    })
      .populate("senderId", "fullName username avatar profilePic")
      .populate("threadParticipants", "fullName username avatar profilePic")
      .lean();

    if (!parent) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Parent message not found.");
    }

    const [replies, total] = await Promise.all([
      GroupMessage.find({
        groupId: toObjectId(groupId),
        parentMessageId: pId,
        isDeleted: { $ne: true },
      })
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(l)
        .populate("senderId", "fullName username avatar profilePic")
        .populate("reactions.userId", "fullName username avatar profilePic")
        .lean(),
      GroupMessage.countDocuments({
        groupId: toObjectId(groupId),
        parentMessageId: pId,
        isDeleted: { $ne: true },
      }),
    ]);

    return {
      parentMessage: formatGroupMessage(parent),
      replies: replies.map(formatGroupMessage),
      totalReplies: total,
      page: p,
      limit: l,
      totalPages: Math.ceil(total / l),
      isGroup: true,
      groupId: String(groupId),
    };
  }

  // Direct chat thread
  const parent = await Message.findOne({
    _id: pId,
  })
    .populate("senderId", "fullName username avatar profilePic")
    .populate("receiverId", "fullName username avatar profilePic")
    .populate("threadParticipants", "fullName username avatar profilePic")
    .lean();

  if (!parent) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Parent message not found.");
  }

  const isParticipant =
    String(parent.senderId._id || parent.senderId) === String(userId) ||
    String(parent.receiverId._id || parent.receiverId) === String(userId);
  if (!isParticipant) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Not authorized to access this thread.",
    );
  }

  const [replies, total] = await Promise.all([
    Message.find({
      parentMessageId: pId,
      isDeleted: { $ne: true },
    })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(l)
      .populate("senderId", "fullName username avatar profilePic")
      .populate("reactions.userId", "fullName username avatar profilePic")
      .lean(),
    Message.countDocuments({
      parentMessageId: pId,
      isDeleted: { $ne: true },
    }),
  ]);

  return {
    parentMessage: formatMessage(parent),
    replies: replies.map(formatMessage),
    totalReplies: total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l),
    isGroup: false,
  };
};

/**
 * Sends a reply inside an existing message thread.
 */
export const sendThreadReply = async ({
  userId,
  parentMessageId,
  isGroup = false,
  groupId = null,
  body = {},
  data = {},
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(parentMessageId, "Invalid parent message ID.");

  const payloadData = Object.keys(data).length > 0 ? data : body;
  const pId = toObjectId(parentMessageId);
  const now = new Date();

  if (isGroup) {
    if (!groupId)
      throw new ApiError(StatusCodes.BAD_REQUEST, "Group ID is required.");
    const { group } = await getGroupAndMember(groupId, userId);

    const parent = await GroupMessage.findOne({
      _id: pId,
      groupId: toObjectId(groupId),
    });
    if (!parent) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Parent message not found.");
    }
    if (parent.isDeleted) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Cannot reply to a deleted message.");
    }

    const isE2EE = Boolean(payloadData.e2ee || payloadData.encrypted);
    const reply = await GroupMessage.create({
      groupId: toObjectId(groupId),
      senderId: toObjectId(userId),
      parentMessageId: pId,
      text: payloadData.text || "",
      image: payloadData.image,
      file: payloadData.file,
      audio: payloadData.audio,
      video: payloadData.video,
      clientId: payloadData.clientId,
      e2ee: isE2EE,
      iv: payloadData.iv || undefined,
      keyVersion:
        payloadData.keyVersion != null ? Number(payloadData.keyVersion) : undefined,
    });

    // Update parent message stats
    const updatedParent = await GroupMessage.findByIdAndUpdate(
      pId,
      {
        $inc: { threadReplyCount: 1 },
        $set: { threadLastReplyAt: now },
        $addToSet: { threadParticipants: toObjectId(userId) },
      },
      { new: true }
    );

    const populatedReply = await reply.populate(
      "senderId",
      "fullName username avatar profilePic",
    );
    const replyPayload = formatGroupMessage(populatedReply);

    // Socket broadcasts
    io.to(String(groupId)).emit("groupThreadReply", {
      groupId: String(groupId),
      parentMessageId: String(pId),
      reply: replyPayload,
    });
    io.to(String(groupId)).emit("threadUpdated", {
      groupId: String(groupId),
      parentMessageId: String(pId),
      threadReplyCount: updatedParent?.threadReplyCount || (parent.threadReplyCount || 0) + 1,
      threadLastReplyAt: now,
    });

    // Notification
    if (String(parent.senderId) !== String(userId)) {
      notificationService
        .dispatchNotification({
          recipientId: parent.senderId,
          senderId: userId,
          category: "group",
          type: "group_reply",
          title: `Reply in ${group.name}`,
          body: isE2EE
            ? "🔒 Encrypted reply"
            : (data.text ? data.text.slice(0, 80) : "Replied in thread"),
          data: {
            groupId: String(groupId),
            parentMessageId: String(pId),
            messageId: String(reply._id),
          },
        })
        .catch(() => {});
    }

    return {
      reply: replyPayload,
      parentMessage: {
        id: String(pId),
        threadReplyCount: updatedParent?.threadReplyCount || (parent.threadReplyCount || 0) + 1,
        threadLastReplyAt: now,
      },
      ...replyPayload,
    };
  }

  // Direct chat thread reply
  const parent = await Message.findOne({
    _id: pId,
  });
  if (!parent) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Parent message not found.");
  }
  if (parent.isDeleted) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Cannot reply to a deleted message.");
  }

  const peerId =
    String(parent.senderId) === String(userId)
      ? parent.receiverId
      : parent.senderId;

  await assertCanMessage(userId, peerId);

  const isDirectE2EE = Boolean(payloadData.e2ee || payloadData.encrypted);
  const reply = await Message.create({
    senderId: toObjectId(userId),
    receiverId: toObjectId(peerId),
    parentMessageId: pId,
    text: payloadData.text || "",
    image: payloadData.image,
    file: payloadData.file,
    audio: payloadData.audio,
    video: payloadData.video,
    clientId: payloadData.clientId,
    e2ee: isDirectE2EE,
    iv: payloadData.iv || undefined,
    keyEnvelopes: Array.isArray(payloadData.keyEnvelopes)
      ? payloadData.keyEnvelopes
      : undefined,
    status: "sent",
  });

  // Update parent message stats
  const updatedParent = await Message.findByIdAndUpdate(
    pId,
    {
      $inc: { threadReplyCount: 1 },
      $set: { threadLastReplyAt: now },
      $addToSet: { threadParticipants: toObjectId(userId) },
    },
    { new: true }
  );

  const populatedReply = await reply.populate(
    "senderId",
    "fullName username avatar profilePic",
  );
  const replyPayload = formatMessage(populatedReply);

  const u1 = String(userId);
  const u2 = String(peerId);

  io.to(u1)
    .to(u2)
    .emit("threadReply", {
      parentMessageId: String(pId),
      reply: replyPayload,
    });
  io.to(u1)
    .to(u2)
    .emit("threadUpdated", {
      parentMessageId: String(pId),
      threadReplyCount: updatedParent?.threadReplyCount || (parent.threadReplyCount || 0) + 1,
      threadLastReplyAt: now,
    });

  // Notification
  if (String(parent.senderId) !== String(userId)) {
    notificationService
      .dispatchNotification({
        recipientId: parent.senderId,
        senderId: userId,
        category: "message",
        type: "message_reply",
        title: "New Thread Reply",
        body: isDirectE2EE
          ? "🔒 Encrypted reply"
          : (data.text ? data.text.slice(0, 80) : "Replied in thread"),
        data: {
          conversationId: u1,
          peerId: u1,
          parentMessageId: String(pId),
          messageId: String(reply._id),
        },
      })
      .catch(() => {});
  }

  return {
    reply: replyPayload,
    parentMessage: {
      id: String(pId),
      threadReplyCount: (parent.threadReplyCount || 0) + 1,
      threadLastReplyAt: now,
    },
    ...replyPayload,
  };
};

export default {
  getThread,
  sendThreadReply,
};
