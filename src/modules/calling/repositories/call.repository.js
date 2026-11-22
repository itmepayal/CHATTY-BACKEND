import mongoose from "mongoose";
import Call from "../models/call.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const findHistoryForUser = (
  userId,
  { skip = 0, limit = 20, status = null, direction = null, type = null } = {},
  options = {},
) => {
  const uid = toObjectId(userId);
  const filter = {
    $or: [{ callerId: uid }, { receiverId: uid }],
    deletedFor: { $ne: uid },
  };

  if (status) {
    if (status === "missed") {
      filter.status = "missed";
      filter.receiverId = uid;
    } else {
      filter.status = status;
    }
  }

  if (direction === "incoming") {
    filter.receiverId = uid;
  } else if (direction === "outgoing") {
    filter.callerId = uid;
  }

  if (type) {
    filter.type = type;
  }

  const query = Call.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("callerId receiverId", "fullName avatar profilePhotoVisibility profilePhotoExceptions");
  if (options.session) query.session(options.session);
  return query;
};

export const deleteCallForUser = async (callId, userId) => {
  const uid = toObjectId(userId);
  const idConditions = [{ callId: String(callId) }];
  if (mongoose.Types.ObjectId.isValid(callId)) {
    idConditions.push({ _id: toObjectId(callId) });
  }

  return Call.findOneAndUpdate(
    {
      $and: [
        { $or: [{ callerId: uid }, { receiverId: uid }] },
        { $or: idConditions },
      ],
    },
    { $addToSet: { deletedFor: uid } },
    { new: true },
  );
};

export const deleteCallsForUser = async (callIds, userId) => {
  if (!Array.isArray(callIds) || callIds.length === 0) {
    return { modifiedCount: 0 };
  }
  const uid = toObjectId(userId);
  const objectIds = callIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map(toObjectId);
  const stringIds = callIds.map(String);

  const idConditions = [];
  if (objectIds.length > 0) {
    idConditions.push({ _id: { $in: objectIds } });
  }
  if (stringIds.length > 0) {
    idConditions.push({ callId: { $in: stringIds } });
  }

  if (idConditions.length === 0) {
    return { modifiedCount: 0 };
  }

  const filter = {
    $and: [
      { $or: [{ callerId: uid }, { receiverId: uid }] },
      { deletedFor: { $ne: uid } },
      { $or: idConditions },
    ],
  };

  return Call.updateMany(filter, { $addToSet: { deletedFor: uid } });
};

export const clearHistoryForUser = async (userId) => {
  const uid = toObjectId(userId);
  return Call.updateMany(
    {
      $or: [{ callerId: uid }, { receiverId: uid }],
      deletedFor: { $ne: uid },
    },
    { $addToSet: { deletedFor: uid } },
  );
};

export const upsertByCallId = (finalCallId, setOnInsert, options = {}) =>
  Call.findOneAndUpdate(
    { callId: finalCallId },
    { $setOnInsert: setOnInsert },
    { upsert: true, new: true, ...options },
  );

export const findByCallId = (callId, options = {}) => {
  const query = Call.findOne({ callId });
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const deleteForUser = (userId, options = {}) => {
  const uid = toObjectId(userId);
  return Call.deleteMany(
    { $or: [{ callerId: uid }, { receiverId: uid }] },
    options,
  );
};

export const findById = (id, options = {}) => {
  const query = Call.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findCallById = (id, options) => findById(id, options).lean();

export const create = async (callData, options = {}) => {
  if (options.session) {
    const [doc] = await Call.create([callData], { session: options.session });
    return doc;
  }
  return Call.create(callData);
};

export const createCall = (data, options) => create(data, options);

export const updateCallByCallId = async (
  callId,
  update,
  options = { new: true },
) => {
  const query = Call.findOneAndUpdate({ callId }, update, {
    new: true,
    runValidators: true,
    ...options,
  });
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const countCallsByUser = (userId, options = {}) => {
  const uid = toObjectId(userId);
  const query = Call.countDocuments({
    $or: [{ callerId: uid }, { receiverId: uid }],
  });
  if (options.session) query.session(options.session);
  return query;
};

export const markCallsAsReadForUser = (
  userId,
  { callerId = null, callIds = null } = {},
  options = {},
) => {
  const uid = toObjectId(userId);
  const filter = {
    receiverId: uid,
    $or: [
      { seen: false },
      { seen: { $exists: false } },
      { readBy: { $ne: uid } },
    ],
  };

  if (callerId) {
    filter.callerId = toObjectId(callerId);
  }

  if (Array.isArray(callIds) && callIds.length > 0) {
    const validIds = callIds.map(toObjectId).filter(Boolean);
    if (validIds.length > 0) {
      filter._id = { $in: validIds };
    }
  }

  return Call.updateMany(
    filter,
    {
      $set: { seen: true, seenAt: new Date() },
      $addToSet: { readBy: uid },
    },
    options,
  );
};

export const countUnreadMissedCalls = (userId, options = {}) => {
  const uid = toObjectId(userId);
  const filter = {
    receiverId: uid,
    seen: { $ne: true },
    readBy: { $ne: uid },
    $or: [
      { status: { $in: ["missed", "rejected", "no-answer", "unanswered"] } },
      { status: "cancelled", answeredAt: { $exists: false } },
      { status: "cancelled", answeredAt: null },
    ],
  };
  const query = Call.countDocuments(filter);
  if (options.session) query.session(options.session);
  return query;
};

export const deleteMany = (filter, options = {}) =>
  Call.deleteMany(filter, options);

const callRepository = Object.freeze({
  findHistoryForUser,
  upsertByCallId,
  findByCallId,
  deleteForUser,
  deleteCallForUser,
  deleteCallsForUser,
  clearHistoryForUser,
  findById,
  findCallById,
  create,
  createCall,
  updateCallByCallId,
  countCallsByUser,
  markCallsAsReadForUser,
  countUnreadMissedCalls,
  deleteMany,
});

export default callRepository;
