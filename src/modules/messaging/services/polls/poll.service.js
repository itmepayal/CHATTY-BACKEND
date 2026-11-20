import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../shared/errors/api-error.js";
import Message from "../../models/message.model.js";
import GroupMessage from "../../../groups/models/group-message.model.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { getGroupAndMember } from "../../../groups/helpers/group.member.helpers.js";
import { io } from "../../../../infrastructure/socket/socket.js";
import * as notificationService from "../../../notifications/services/notification.service.js";
import { assertValidObjectId, toObjectId } from "../../../../shared/utils/object-id.util.js";
import { formatMessage, emitConversationUpdate } from "../../utils/message-helpers.js";
import { formatGroupMessage, broadcastGroupMessage, emitGroupConversation } from "../../../groups/services/group.service.js";

const formatPollResponse = (poll, currentUserId) => {
  if (!poll) return null;
  const isAnon = Boolean(poll.isAnonymous);
  const rawOptions = Array.isArray(poll.options) ? poll.options : [];
  const totalVotes = rawOptions.reduce(
    (sum, opt) => sum + (Array.isArray(opt.votes) ? opt.votes.length : (opt.voteCount || 0)),
    0,
  );

  const uniqueVoterSet = new Set();
  rawOptions.forEach((opt) => {
    (opt.votes || []).forEach((v) => {
      const vId = typeof v === "object" && v !== null ? (v._id || v.id) : v;
      if (vId) uniqueVoterSet.add(String(vId));
    });
  });
  const totalVoters = uniqueVoterSet.size;

  const formattedOptions = rawOptions.map((opt) => {
    const votesArr = Array.isArray(opt.votes) ? opt.votes : [];
    const voteCount = votesArr.length || opt.voteCount || 0;
    const denominator = poll.allowMultipleAnswers ? (totalVoters || totalVotes) : totalVotes;
    const percentage = denominator > 0 ? Math.round((voteCount / denominator) * 100) : 0;
    const hasVoted = Boolean(
      currentUserId &&
        votesArr.some((v) => {
          const vId = typeof v === "object" && v !== null ? (v._id || v.id) : v;
          return String(vId) === String(currentUserId);
        }),
    );

    return {
      _id: String(opt._id || opt.id || opt.text),
      text: opt.text,
      voteCount,
      percentage,
      hasVoted,
      votes: votesArr.map((v) =>
        typeof v === "object" && v !== null && (v._id || v.id)
          ? String(v._id || v.id)
          : String(v),
      ),
      voters: isAnon
        ? []
        : votesArr.map((v) =>
            typeof v === "object" && v !== null
              ? {
                  id: String(v._id || v.id),
                  fullName: v.fullName || "User",
                  username: v.username || "",
                  avatar: v.avatar?.url || (typeof v.avatar === "string" ? v.avatar : "") || "",
                }
              : { id: String(v) },
          ),
    };
  });

  const isClosed = Boolean(poll.isClosed || poll.isEnded);

  return {
    question: poll.question,
    type: poll.type || (poll.allowMultipleAnswers ? "multiple" : "single"),
    options: formattedOptions,
    isAnonymous: isAnon,
    allowMultipleAnswers: Boolean(poll.allowMultipleAnswers),
    canChangeVote: poll.canChangeVote !== false,
    isClosed,
    isEnded: isClosed,
    closedBy: poll.closedBy ? String(poll.closedBy._id || poll.closedBy) : null,
    closedAt: poll.closedAt || poll.endedAt || null,
    endedAt: poll.endedAt || poll.closedAt || null,
    createdBy: poll.createdBy ? String(poll.createdBy._id || poll.createdBy) : null,
    expiresAt: poll.expiresAt || null,
    totalVotes,
    totalVoters,
  };
};

/**
 * Creates a poll message in a direct chat or group chat.
 */
export const createPoll = async ({
  userId,
  targetId,
  isGroup = false,
  question,
  options = [],
  isAnonymous = false,
  allowMultipleAnswers = false,
  canChangeVote = true,
  expiresAt = null,
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(targetId, "Invalid target ID.");

  const q = String(question || "").trim();
  if (!q || q.length > 500) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Poll question must be between 1 and 500 characters.");
  }

  if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Poll must have between 2 and 10 options.");
  }

  const cleanedOptions = options.map((opt) => {
    const text = typeof opt === "string" ? opt.trim() : String(opt?.text || "").trim();
    if (!text || text.length > 200) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Each poll option must be between 1 and 200 characters.");
    }
    return { text, votes: [] };
  });

  let expDate = null;
  if (expiresAt) {
    expDate = new Date(expiresAt);
    if (isNaN(expDate.getTime()) || expDate <= new Date()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Poll expiration date must be in the future.");
    }
  }

  const pollData = {
    question: q,
    type: allowMultipleAnswers ? "multiple" : "single",
    options: cleanedOptions,
    isAnonymous: Boolean(isAnonymous),
    allowMultipleAnswers: Boolean(allowMultipleAnswers),
    canChangeVote: canChangeVote !== false,
    isClosed: false,
    isEnded: false,
    createdBy: toObjectId(userId),
    expiresAt: expDate,
  };

  if (isGroup) {
    const { group } = await getGroupAndMember(targetId, userId);
    const groupMessage = await GroupMessage.create({
      groupId: toObjectId(targetId),
      senderId: toObjectId(userId),
      text: `📊 Poll: ${q}`,
      poll: pollData,
      readBy: [toObjectId(userId)],
    });

    const populated = await GroupMessage.findById(groupMessage._id)
      .populate("senderId", "fullName username avatar profilePic")
      .lean();

    const payload = formatGroupMessage(populated, userId);
    await broadcastGroupMessage(group, groupMessage, userId);
    await emitGroupConversation(group);

    return { message: payload, poll: formatPollResponse(populated.poll, userId) };
  }

  // Direct chat
  await assertCanMessage(userId, targetId);
  const message = await Message.create({
    senderId: toObjectId(userId),
    receiverId: toObjectId(targetId),
    text: `📊 Poll: ${q}`,
    poll: pollData,
    status: "sent",
  });

  const populated = await Message.findById(message._id)
    .populate("senderId", "fullName username avatar profilePic")
    .populate("receiverId", "fullName username avatar profilePic")
    .lean();

  const payload = formatMessage(populated);

  io.to(String(userId)).to(String(targetId)).emit("newMessage", payload);
  await Promise.allSettled([
    emitConversationUpdate(userId, targetId),
    emitConversationUpdate(targetId, userId),
  ]);

  if (typeof notificationService.dispatchNotification === "function") {
    notificationService
      .dispatchNotification({
        recipientId: targetId,
        senderId: userId,
        category: "message",
        type: "message_received",
        title: "New Poll",
        body: `📊 ${q}`,
        data: {
          conversationId: String(userId),
          peerId: String(userId),
          messageId: String(message._id),
          isPoll: true,
        },
      })
      .catch((err) => console.error("[poll] Failed to create notification:", err?.message));
  }

  return { message: payload, poll: formatPollResponse(populated.poll, userId) };
};

/**
 * Casts or changes a vote on a poll.
 */
export const castVote = async ({
  userId,
  messageId,
  isGroup = false,
  groupId = null,
  optionIds = [],
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(messageId, "Invalid message ID.");

  const targetOptionIdList = Array.isArray(optionIds)
    ? optionIds
    : optionIds !== undefined && optionIds !== null
      ? [optionIds]
      : [];

  const Model = isGroup ? GroupMessage : Message;
  let roomTarget;

  if (isGroup) {
    if (!groupId) throw new ApiError(StatusCodes.BAD_REQUEST, "groupId is required for group polls.");
    await getGroupAndMember(groupId, userId);
    roomTarget = `group:${groupId}`;
  } else {
    const existing = await Message.findOne({
      _id: toObjectId(messageId),
      isDeleted: { $ne: true },
    });
    if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "Poll message not found.");

    const isParticipant =
      String(existing.senderId) === String(userId) ||
      String(existing.receiverId) === String(userId);
    if (!isParticipant) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Not authorized to vote on this poll.");
    }
    const peerId =
      String(existing.senderId) === String(userId) ? existing.receiverId : existing.senderId;
    await assertCanMessage(userId, peerId);
  }

  // Pre-validate input option IDs
  const targetOptionIdStrings = new Set(targetOptionIdList.map(String));

  // Concurrency-safe atomic optimistic retry loop (up to 3 retries)
  const userOid = toObjectId(userId);
  let finalMessage = null;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const query = isGroup
      ? { _id: toObjectId(messageId), groupId: toObjectId(groupId), isDeleted: { $ne: true } }
      : { _id: toObjectId(messageId), isDeleted: { $ne: true } };

    const currentDoc = await Model.findOne(query);
    if (!currentDoc || !currentDoc.poll || !currentDoc.poll.question) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Poll not found on this message.");
    }

    const poll = currentDoc.poll;

    if (poll.isClosed || poll.isEnded) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "This poll has ended.");
    }

    if (poll.expiresAt && new Date(poll.expiresAt) <= new Date()) {
      poll.isClosed = true;
      poll.isEnded = true;
      poll.closedAt = new Date();
      poll.endedAt = poll.closedAt;
      await currentDoc.save();
      throw new ApiError(StatusCodes.BAD_REQUEST, "This poll has expired.");
    }

    // Verify all optionIds exist in poll options
    for (const optId of targetOptionIdStrings) {
      const exists = (poll.options || []).some(
        (o) => String(o._id || o.id || o.text) === optId,
      );
      if (!exists) {
        throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid poll option ID: ${optId}`);
      }
    }

    if (!poll.allowMultipleAnswers && targetOptionIdStrings.size > 1) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Multiple answers are not allowed on this poll.");
    }

    // Check if user already voted and whether vote changing is permitted
    const previouslyVotedOptionIds = [];
    for (const opt of poll.options || []) {
      if (opt.votes && opt.votes.some((v) => String(v._id || v) === String(userId))) {
        previouslyVotedOptionIds.push(String(opt._id || opt.id || opt.text));
      }
    }

    if (previouslyVotedOptionIds.length > 0 && poll.canChangeVote === false) {
      const sameVotes =
        previouslyVotedOptionIds.length === targetOptionIdStrings.size &&
        previouslyVotedOptionIds.every((id) => targetOptionIdStrings.has(id));
      if (!sameVotes) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Vote cannot be changed on this poll.");
      }
    }

    // Compute updated options array atomically
    const updatedOptions = (poll.options || []).map((opt) => {
      const optIdStr = String(opt._id || opt.id || opt.text);
      const shouldHaveVote = targetOptionIdStrings.has(optIdStr);
      // Remove user's previous vote from this option first
      const otherVotes = (opt.votes || []).filter(
        (v) => String(v._id || v) !== String(userId),
      );
      return {
        _id: opt._id,
        text: opt.text,
        votes: shouldHaveVote ? [...otherVotes, userOid] : otherVotes,
      };
    });

    const docVersion = currentDoc.__v;
    const updateCond = isGroup
      ? {
          _id: toObjectId(messageId),
          groupId: toObjectId(groupId),
          __v: docVersion,
          "poll.isClosed": { $ne: true },
          "poll.isEnded": { $ne: true },
        }
      : {
          _id: toObjectId(messageId),
          __v: docVersion,
          "poll.isClosed": { $ne: true },
          "poll.isEnded": { $ne: true },
        };

    const updated = await Model.findOneAndUpdate(
      updateCond,
      {
        $set: { "poll.options": updatedOptions },
        $inc: { __v: 1 },
      },
      { new: true },
    );

    if (updated) {
      finalMessage = updated;
      break;
    }
  }

  if (!finalMessage) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Voting conflict or poll already ended. Please retry.",
    );
  }

  // Populate voters for response and broadcast
  let populatedMessage;
  if (isGroup) {
    populatedMessage = await GroupMessage.findById(finalMessage._id)
      .populate("poll.options.votes", "fullName username avatar profilePic")
      .lean();
  } else {
    populatedMessage = await Message.findById(finalMessage._id)
      .populate("poll.options.votes", "fullName username avatar profilePic")
      .lean();
  }

  const pollPayload = {
    messageId: String(finalMessage._id),
    isGroup,
    groupId: groupId ? String(groupId) : null,
    poll: formatPollResponse(populatedMessage.poll, userId),
  };

  if (isGroup) {
    io.to(roomTarget).emit("pollUpdated", pollPayload);
  } else {
    io.to(String(finalMessage.senderId))
      .to(String(finalMessage.receiverId))
      .emit("pollUpdated", pollPayload);
  }

  return pollPayload;
};

/**
 * Closes an active poll.
 */
export const closePoll = async ({ userId, messageId, isGroup = false, groupId = null }) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(messageId, "Invalid message ID.");

  const Model = isGroup ? GroupMessage : Message;
  let roomTarget;
  let currentDoc;

  if (isGroup) {
    if (!groupId) throw new ApiError(StatusCodes.BAD_REQUEST, "groupId is required.");
    const { group, member } = await getGroupAndMember(groupId, userId);
    currentDoc = await GroupMessage.findOne({
      _id: toObjectId(messageId),
      groupId: toObjectId(groupId),
      isDeleted: { $ne: true },
    });
    if (!currentDoc) throw new ApiError(StatusCodes.NOT_FOUND, "Poll message not found.");

    const isCreator = String(currentDoc.senderId) === String(userId);
    const isAdmin = member?.role === "admin" || String(group.owner) === String(userId);
    if (!isCreator && !isAdmin) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Only the poll creator or group admin can end this poll.");
    }
    roomTarget = `group:${groupId}`;
  } else {
    currentDoc = await Message.findOne({
      _id: toObjectId(messageId),
      isDeleted: { $ne: true },
    });
    if (!currentDoc) throw new ApiError(StatusCodes.NOT_FOUND, "Poll message not found.");

    if (String(currentDoc.senderId) !== String(userId)) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Only the poll creator can end this poll.");
    }
  }

  if (!currentDoc.poll || !currentDoc.poll.question) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This message is not a poll.");
  }

  if (currentDoc.poll.isClosed || currentDoc.poll.isEnded) {
    // Idempotent: poll already ended
    const pollPayload = {
      messageId: String(currentDoc._id),
      isGroup,
      groupId: groupId ? String(groupId) : null,
      poll: formatPollResponse(currentDoc.poll, userId),
    };
    return pollPayload;
  }

  const now = new Date();
  const updateCond = isGroup
    ? {
        _id: toObjectId(messageId),
        groupId: toObjectId(groupId),
        "poll.isClosed": { $ne: true },
        "poll.isEnded": { $ne: true },
      }
    : {
        _id: toObjectId(messageId),
        "poll.isClosed": { $ne: true },
        "poll.isEnded": { $ne: true },
      };

  const updatedMessage = await Model.findOneAndUpdate(
    updateCond,
    {
      $set: {
        "poll.isClosed": true,
        "poll.isEnded": true,
        "poll.closedBy": toObjectId(userId),
        "poll.closedAt": now,
        "poll.endedAt": now,
      },
      $inc: { __v: 1 },
    },
    { new: true },
  );

  const finalDoc = updatedMessage || currentDoc;
  const pollPayload = {
    messageId: String(finalDoc._id),
    isGroup,
    groupId: groupId ? String(groupId) : null,
    poll: formatPollResponse(finalDoc.poll, userId),
  };

  if (isGroup) {
    io.to(roomTarget).emit("pollUpdated", pollPayload);
  } else {
    io.to(String(finalDoc.senderId))
      .to(String(finalDoc.receiverId))
      .emit("pollUpdated", pollPayload);
  }

  return pollPayload;
};

/**
 * Gets detailed poll info with voters (if not anonymous).
 */
export const getPollDetails = async ({ userId, messageId, isGroup = false, groupId = null }) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(messageId, "Invalid message ID.");

  let message;
  if (isGroup) {
    if (!groupId) throw new ApiError(StatusCodes.BAD_REQUEST, "groupId is required.");
    await getGroupAndMember(groupId, userId);
    message = await GroupMessage.findOne({
      _id: toObjectId(messageId),
      groupId: toObjectId(groupId),
      isDeleted: { $ne: true },
    })
      .populate("poll.options.votes", "fullName username avatar profilePic")
      .lean();
  } else {
    message = await Message.findOne({
      _id: toObjectId(messageId),
      isDeleted: { $ne: true },
    })
      .populate("poll.options.votes", "fullName username avatar profilePic")
      .lean();

    if (!message) throw new ApiError(StatusCodes.NOT_FOUND, "Poll message not found.");
    const isParticipant =
      String(message.senderId) === String(userId) ||
      String(message.receiverId) === String(userId);
    if (!isParticipant) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Not authorized to view this poll.");
    }
  }

  if (!message || !message.poll) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Poll not found.");
  }

  return {
    messageId: String(message._id),
    isGroup,
    groupId: groupId ? String(groupId) : null,
    poll: formatPollResponse(message.poll, userId),
  };
};
