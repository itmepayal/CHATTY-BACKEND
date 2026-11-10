import Group from "../models/group.model.js";
import GroupMessage from "../models/group-message.model.js";
import GroupArchive from "../models/group-archive.model.js";
import GroupKey from "../models/group-key.model.js";
import { toObjectId } from "../utils/object-id.util.js";

// --- Group Queries ---

/**
 * Finds a group by ID.
 * @param {string|import("mongoose").Types.ObjectId} groupId
 * @param {string|object} [projection]
 * @returns {Promise<object|null>}
 */
export const findGroupById = async (groupId, projection) => {
  const query = Group.findById(toObjectId(groupId));
  if (projection) query.select(projection);
  return query.lean();
};

/**
 * Finds an un-leaned mutable group document by ID.
 * @param {string|import("mongoose").Types.ObjectId} groupId
 * @param {string|object} [projection]
 * @returns {Promise<import("mongoose").Document|null>}
 */
export const findGroupDocumentById = async (groupId, projection) => {
  const query = Group.findById(toObjectId(groupId));
  if (projection) query.select(projection);
  return query;
};

/**
 * Creates and persists a new group.
 * @param {object} groupData
 * @returns {Promise<import("mongoose").Document>}
 */
export const createGroup = async (groupData) => {
  return Group.create(groupData);
};

/**
 * Updates a group by ID.
 * @param {string|import("mongoose").Types.ObjectId} groupId
 * @param {object} update
 * @param {object} [options={ new: true }]
 * @returns {Promise<object|null>}
 */
export const updateGroupById = async (groupId, update, options = { new: true }) => {
  return Group.findByIdAndUpdate(toObjectId(groupId), update, options).lean();
};

/**
 * Deletes a group by ID.
 * @param {string|import("mongoose").Types.ObjectId} groupId
 * @returns {Promise<object|null>}
 */
export const deleteGroupById = async (groupId) => {
  return Group.findByIdAndDelete(toObjectId(groupId)).lean();
};

/**
 * Finds all groups that a user is a member of.
 * @param {string|import("mongoose").Types.ObjectId} userId
 * @returns {Promise<object[]>}
 */
export const findGroupsByMemberId = async (userId) => {
  return Group.find({ "members.user": toObjectId(userId) }).lean();
};

// --- Group Message Queries ---

/**
 * Finds a group message by ID.
 * @param {string|import("mongoose").Types.ObjectId} messageId
 * @returns {Promise<object|null>}
 */
export const findGroupMessageById = async (messageId) => {
  return GroupMessage.findById(toObjectId(messageId)).lean();
};

/**
 * Creates and persists a new group message.
 * @param {object} messageData
 * @returns {Promise<import("mongoose").Document>}
 */
export const createGroupMessage = async (messageData) => {
  return GroupMessage.create(messageData);
};

/**
 * Updates a group message by ID.
 * @param {string|import("mongoose").Types.ObjectId} messageId
 * @param {object} update
 * @param {object} [options={ new: true }]
 * @returns {Promise<object|null>}
 */
export const updateGroupMessageById = async (messageId, update, options = { new: true }) => {
  return GroupMessage.findByIdAndUpdate(toObjectId(messageId), update, options).lean();
};

/**
 * Deletes all messages for a given group.
 * @param {string|import("mongoose").Types.ObjectId} groupId
 * @returns {Promise<{ deletedCount: number }>}
 */
export const deleteGroupMessagesByGroupId = async (groupId) => {
  return GroupMessage.deleteMany({ groupId: toObjectId(groupId) });
};

// --- Group Archive Queries ---

export const findGroupArchive = async (userId, groupId) => {
  return GroupArchive.findOne({
    userId: toObjectId(userId),
    groupId: toObjectId(groupId),
  }).lean();
};

export const addGroupArchive = async (userId, groupId) => {
  return GroupArchive.findOneAndUpdate(
    { userId: toObjectId(userId), groupId: toObjectId(groupId) },
    { $setOnInsert: { archivedAt: new Date() } },
    { upsert: true, new: true },
  ).lean();
};

export const removeGroupArchive = async (userId, groupId) => {
  return GroupArchive.findOneAndDelete({
    userId: toObjectId(userId),
    groupId: toObjectId(groupId),
  }).lean();
};

export const deleteGroupArchivesByGroupId = async (groupId) => {
  return GroupArchive.deleteMany({ groupId: toObjectId(groupId) });
};

// --- Group Key Queries ---

export const findGroupKeysByGroupId = async (groupId) => {
  return GroupKey.find({ groupId: toObjectId(groupId) }).lean();
};

export const upsertGroupKey = async (groupId, userId, encryptedKey) => {
  return GroupKey.findOneAndUpdate(
    { groupId: toObjectId(groupId), userId: toObjectId(userId) },
    { $set: { encryptedKey } },
    { upsert: true, new: true },
  ).lean();
};

export const deleteGroupKeysByGroupId = async (groupId) => {
  return GroupKey.deleteMany({ groupId: toObjectId(groupId) });
};

const groupRepository = {
  findGroupById,
  findGroupDocumentById,
  createGroup,
  updateGroupById,
  deleteGroupById,
  findGroupsByMemberId,
  findGroupMessageById,
  createGroupMessage,
  updateGroupMessageById,
  deleteGroupMessagesByGroupId,
  findGroupArchive,
  addGroupArchive,
  removeGroupArchive,
  deleteGroupArchivesByGroupId,
  findGroupKeysByGroupId,
  upsertGroupKey,
  deleteGroupKeysByGroupId,
};

export default groupRepository;
