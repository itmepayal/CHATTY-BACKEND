import GroupCall from "../../models/group-call.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export const findForGroupAfter = (
  groupId,
  joinedAt,
  { skip = 0, limit = 20 } = {},
  options = {},
) => {
  const query = GroupCall.find({
    groupId: toObjectId(groupId),
    startedAt: { $gte: joinedAt },
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("startedBy", "fullName avatar profilePhotoVisibility")
    .populate("participants", "fullName avatar profilePhotoVisibility");
  if (options.session) query.session(options.session);
  return query;
};

export const findByGroupIds = (
  groupIds,
  { skip = 0, limit = 20 } = {},
  options = {},
) => {
  const query = GroupCall.find({ groupId: { $in: groupIds.map(toObjectId) } })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("startedBy", "fullName avatar profilePhotoVisibility")
    .populate("participants", "fullName avatar profilePhotoVisibility");
  if (options.session) query.session(options.session);
  return query;
};

export const upsertByCallId = (finalCallId, setOnInsert, options = {}) =>
  GroupCall.findOneAndUpdate(
    { callId: finalCallId },
    { $setOnInsert: setOnInsert },
    { upsert: true, new: true, ...options },
  );

export const findByCallId = (callId, options = {}) => {
  const query = GroupCall.findOne({ callId });
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const deleteForGroup = (groupId, options = {}) =>
  GroupCall.deleteMany({ groupId: toObjectId(groupId) }, options);

export const deleteMany = (filter, options = {}) =>
  GroupCall.deleteMany(filter, options);

export const findById = (id, options = {}) => {
  const query = GroupCall.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findGroupCallById = (id, options) => findById(id, options).lean();

export const create = async (groupCallData, options = {}) => {
  if (options.session) {
    const [doc] = await GroupCall.create([groupCallData], {
      session: options.session,
    });
    return doc;
  }
  return GroupCall.create(groupCallData);
};

export const createGroupCall = (data, options) => create(data, options);

export const countDocuments = (filter = {}, options = {}) => {
  const query = GroupCall.countDocuments(filter);
  if (options.session) query.session(options.session);
  return query;
};

export const count = (filter, options) => countDocuments(filter, options);

const groupCallRepository = Object.freeze({
  findForGroupAfter,
  findByGroupIds,
  upsertByCallId,
  findByCallId,
  deleteForGroup,
  deleteMany,
  findById,
  findGroupCallById,
  create,
  createGroupCall,
  countDocuments,
  count,
});

export default groupCallRepository;
