import Call from "../../models/call.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export const findHistoryForUser = (
  userId,
  { skip = 0, limit = 20 } = {},
  options = {},
) => {
  const uid = toObjectId(userId);
  const query = Call.find({
    $or: [{ callerId: uid }, { receiverId: uid }],
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("callerId receiverId", "fullName avatar profilePhotoVisibility");
  if (options.session) query.session(options.session);
  return query;
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

export const deleteMany = (filter, options = {}) =>
  Call.deleteMany(filter, options);

const callRepository = Object.freeze({
  findHistoryForUser,
  upsertByCallId,
  findByCallId,
  deleteForUser,
  findById,
  findCallById,
  create,
  createCall,
  updateCallByCallId,
  countCallsByUser,
  deleteMany,
});

export default callRepository;
