import Message from "../models/message.model.js";
import ChatSetting from "../models/chat-setting.model.js";
import ChatArchive from "../models/chat-archive.model.js";
import ScheduledMessage from "../models/scheduled-message.model.js";
import Report from "../models/report.model.js";
import LocationShare from "../models/location-share.model.js";
import { toObjectId } from "../utils/object-id.util.js";

// --- Direct Message Queries ---

/**
 * Finds a single message by ID.
 * @param {string|import("mongoose").Types.ObjectId} messageId
 * @param {string|object} [projection]
 * @returns {Promise<object|null>}
 */
export const findMessageById = async (messageId, projection) => {
  const query = Message.findById(toObjectId(messageId));
  if (projection) query.select(projection);
  return query.lean();
};

/**
 * Finds a single mutable message document by ID.
 * @param {string|import("mongoose").Types.ObjectId} messageId
 * @param {string|object} [projection]
 * @returns {Promise<import("mongoose").Document|null>}
 */
export const findMessageDocumentById = async (messageId, projection) => {
  const query = Message.findById(toObjectId(messageId));
  if (projection) query.select(projection);
  return query;
};

/**
 * Creates and persists a new Message document.
 * @param {object} messageData
 * @returns {Promise<import("mongoose").Document>}
 */
export const createMessage = async (messageData) => {
  return Message.create(messageData);
};

/**
 * Updates a message by ID.
 * @param {string|import("mongoose").Types.ObjectId} messageId
 * @param {object} update
 * @param {object} [options={ new: true }]
 * @returns {Promise<object|null>}
 */
export const updateMessageById = async (messageId, update, options = { new: true }) => {
  return Message.findByIdAndUpdate(toObjectId(messageId), update, options).lean();
};

/**
 * Finds messages between two users respecting deletion visibility.
 * @param {string|import("mongoose").Types.ObjectId} userA
 * @param {string|import("mongoose").Types.ObjectId} userB
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
export const findConversationMessages = async (userA, userB, options = {}) => {
  const a = toObjectId(userA);
  const b = toObjectId(userB);
  const query = {
    $or: [
      { senderId: a, receiverId: b },
      { senderId: b, receiverId: a },
    ],
    deletedFor: { $ne: a },
    deletedForEveryone: { $ne: true },
  };

  const cursor = Message.find(query).sort({ createdAt: 1 });
  if (options.limit) cursor.limit(options.limit);
  if (options.skip) cursor.skip(options.skip);
  return cursor.lean();
};

/**
 * Counts unread messages sent by partner to user.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {string|import("mongoose").Types.ObjectId} partnerId
 * @returns {Promise<number>}
 */
export const countUnreadMessages = async (userId, partnerId) => {
  return Message.countDocuments({
    senderId: toObjectId(partnerId),
    receiverId: toObjectId(userId),
    status: { $in: ["sent", "delivered"] },
    deletedFor: { $ne: toObjectId(userId) },
    deletedForEveryone: { $ne: true },
  });
};

/**
 * Marks messages from partner to user as seen/delivered.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @param {string|import("mongoose").Types.ObjectId} partnerId
 * @param {string} [targetStatus="seen"]
 * @returns {Promise<{ modifiedCount: number }>}
 */
export const updateMessagesStatus = async (userId, partnerId, targetStatus = "seen") => {
  return Message.updateMany(
    {
      senderId: toObjectId(partnerId),
      receiverId: toObjectId(userId),
      status: { $ne: targetStatus },
    },
    {
      $set: {
        status: targetStatus,
        ...(targetStatus === "seen" ? { seenAt: new Date() } : { deliveredAt: new Date() }),
      },
    },
  );
};

// --- Chat Settings & Archive Queries ---

export const findChatSetting = async (userId, partnerId) => {
  return ChatSetting.findOne({
    userId: toObjectId(userId),
    partnerId: toObjectId(partnerId),
  }).lean();
};

export const upsertChatSetting = async (userId, partnerId, update) => {
  return ChatSetting.findOneAndUpdate(
    { userId: toObjectId(userId), partnerId: toObjectId(partnerId) },
    { $set: update },
    { upsert: true, new: true },
  ).lean();
};

export const findChatArchive = async (userId, chatWith) => {
  return ChatArchive.findOne({
    userId: toObjectId(userId),
    chatWith: toObjectId(chatWith),
  }).lean();
};

export const addChatArchive = async (userId, chatWith) => {
  return ChatArchive.findOneAndUpdate(
    { userId: toObjectId(userId), chatWith: toObjectId(chatWith) },
    { $setOnInsert: { archivedAt: new Date() } },
    { upsert: true, new: true },
  ).lean();
};

export const removeChatArchive = async (userId, chatWith) => {
  return ChatArchive.findOneAndDelete({
    userId: toObjectId(userId),
    chatWith: toObjectId(chatWith),
  }).lean();
};

// --- Scheduled Message Queries ---

export const createScheduledMessage = async (data) => {
  return ScheduledMessage.create(data);
};

export const findScheduledMessageById = async (scheduleId) => {
  return ScheduledMessage.findById(toObjectId(scheduleId)).lean();
};

export const findScheduledMessagesByUser = async (userId, receiverId = null) => {
  const query = {
    senderId: toObjectId(userId),
    status: "pending",
  };
  if (receiverId) {
    query.receiverId = toObjectId(receiverId);
  }
  return ScheduledMessage.find(query).sort({ scheduledFor: 1 }).lean();
};

export const deleteScheduledMessageById = async (scheduleId, userId) => {
  return ScheduledMessage.findOneAndDelete({
    _id: toObjectId(scheduleId),
    senderId: toObjectId(userId),
  }).lean();
};

// --- Report Queries ---

export const createReport = async (reportData) => {
  return Report.create(reportData);
};

export const findRecentReport = async (reporterId, reportedUserId, windowMs = 24 * 60 * 60 * 1000) => {
  const since = new Date(Date.now() - windowMs);
  return Report.findOne({
    reporterId: toObjectId(reporterId),
    reportedUserId: toObjectId(reportedUserId),
    createdAt: { $gte: since },
  }).lean();
};

// --- Location Sharing Queries ---

export const createLocationShare = async (shareData) => {
  return LocationShare.create(shareData);
};

export const findLocationShareById = async (shareId) => {
  return LocationShare.findById(toObjectId(shareId)).lean();
};

export const findActiveLocationSharesForUser = async (userId) => {
  const uid = toObjectId(userId);
  return LocationShare.find({
    $or: [{ userId: uid }, { targetId: uid }],
    isActive: true,
    expiresAt: { $gt: new Date() },
  }).lean();
};

export const stopLocationShare = async (shareId, userId) => {
  return LocationShare.findOneAndUpdate(
    { _id: toObjectId(shareId), userId: toObjectId(userId), isActive: true },
    { $set: { isActive: false, endedAt: new Date() } },
    { new: true },
  ).lean();
};

const messageRepository = {
  findMessageById,
  findMessageDocumentById,
  createMessage,
  updateMessageById,
  findConversationMessages,
  countUnreadMessages,
  updateMessagesStatus,
  findChatSetting,
  upsertChatSetting,
  findChatArchive,
  addChatArchive,
  removeChatArchive,
  createScheduledMessage,
  findScheduledMessageById,
  findScheduledMessagesByUser,
  deleteScheduledMessageById,
  createReport,
  findRecentReport,
  createLocationShare,
  findLocationShareById,
  findActiveLocationSharesForUser,
  stopLocationShare,
};

export default messageRepository;
