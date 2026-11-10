import Call from "../models/call.model.js";
import GroupCall from "../models/group-call.model.js";
import { toObjectId } from "../utils/object-id.util.js";

export const findCallById = async (id) => {
  return Call.findById(toObjectId(id)).lean();
};

export const findCallByCallId = async (callId) => {
  return Call.findOne({ callId }).lean();
};

export const createCall = async (callData) => {
  return Call.create(callData);
};

export const updateCallByCallId = async (
  callId,
  update,
  options = { new: true },
) => {
  return Call.findOneAndUpdate({ callId }, update, options).lean();
};

export const findCallsByUser = async (
  userId,
  {
    skip = 0,
    limit = 20,
    userFields = "fullName username profilePic isOnline lastSeen",
  } = {},
) => {
  const uid = toObjectId(userId);
  return Call.find({
    $or: [{ callerId: uid }, { receiverId: uid }],
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("callerId", userFields)
    .populate("receiverId", userFields)
    .lean();
};

export const countCallsByUser = async (userId) => {
  const uid = toObjectId(userId);
  return Call.countDocuments({
    $or: [{ callerId: uid }, { receiverId: uid }],
  });
};

export const findGroupCallById = async (id) => {
  return GroupCall.findById(toObjectId(id)).lean();
};

export const findGroupCallByCallId = async (callId) => {
  return GroupCall.findOne({ callId }).lean();
};

export const createGroupCall = async (groupCallData) => {
  return GroupCall.create(groupCallData);
};

export const updateGroupCallByCallId = async (
  callId,
  update,
  options = { new: true },
) => {
  return GroupCall.findOneAndUpdate({ callId }, update, options).lean();
};

export const findGroupCallsByUser = async (
  userId,
  {
    skip = 0,
    limit = 20,
    userFields = "fullName username profilePic",
    groupFields = "name avatar",
  } = {},
) => {
  const uid = toObjectId(userId);
  return GroupCall.find({
    $or: [{ startedBy: uid }, { participants: uid }],
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("startedBy", userFields)
    .populate("participants", userFields)
    .populate("groupId", groupFields)
    .lean();
};

export const countGroupCallsByUser = async (userId) => {
  const uid = toObjectId(userId);
  return GroupCall.countDocuments({
    $or: [{ startedBy: uid }, { participants: uid }],
  });
};

export const findGroupCallsByGroupId = async (
  groupId,
  {
    skip = 0,
    limit = 20,
    userFields = "fullName username profilePic",
    groupFields = "name avatar",
  } = {},
) => {
  return GroupCall.find({ groupId: toObjectId(groupId) })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("startedBy", userFields)
    .populate("participants", userFields)
    .populate("groupId", groupFields)
    .lean();
};

export const countGroupCallsByGroupId = async (groupId) => {
  return GroupCall.countDocuments({ groupId: toObjectId(groupId) });
};

const callRepository = {
  findCallById,
  findCallByCallId,
  createCall,
  updateCallByCallId,
  findCallsByUser,
  countCallsByUser,
  findGroupCallById,
  findGroupCallByCallId,
  createGroupCall,
  updateGroupCallByCallId,
  findGroupCallsByUser,
  countGroupCallsByUser,
  findGroupCallsByGroupId,
  countGroupCallsByGroupId,
};

export default callRepository;
