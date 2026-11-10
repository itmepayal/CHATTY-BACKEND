import Group from "../../models/group.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export const create = async (data, options = {}) => {
  if (options.session) {
    const [doc] = await Group.create([data], { session: options.session });
    return doc;
  }
  return Group.create(data);
};

export const createGroup = (data, options) => create(data, options);

export const find = (filter = {}, projection, options = {}) => {
  const query = Group.find(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findMany = (filter, projection, options) =>
  find(filter, projection, options);

export const findOne = (filter = {}, projection, options = {}) => {
  const query = Group.findOne(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findById = (id, options = {}) => {
  const query = Group.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findGroupById = (id, projection, options = {}) => {
  const query = Group.findById(toObjectId(id));
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const loadWithMembers = (id, options = {}) => {
  const query = Group.findById(toObjectId(id)).populate(
    "members.userId",
    "fullName avatar profilePhotoVisibility",
  );
  if (options.session) query.session(options.session);
  return query;
};

export const findByMember = (me, options = {}) => {
  const query = Group.find({ "members.userId": toObjectId(me) }).populate(
    "members.userId",
    "fullName avatar profilePhotoVisibility",
  );
  if (options.session) query.session(options.session);
  return query;
};

export const findByMemberLean = (me, select, options = {}) => {
  const query = Group.find({ "members.userId": toObjectId(me) });
  if (select) query.select(select);
  if (options.session) query.session(options.session);
  return query.lean();
};

export const findMembershipGroups = (userId, options = {}) => {
  const query = Group.find({ "members.userId": toObjectId(userId) });
  if (options.session) query.session(options.session);
  return query;
};

export const updateOne = (filter, update, options = {}) =>
  Group.updateOne(filter, update, options);

export const findOneAndUpdate = (filter, update, options = {}) =>
  Group.findOneAndUpdate(filter, update, options);

export const updateById = async (id, update, options = { new: true }) => {
  const query = Group.findByIdAndUpdate(toObjectId(id), update, {
    new: true,
    runValidators: true,
    ...options,
  });
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const deleteOne = (filter, options = {}) =>
  Group.deleteOne(filter, options);

export const deleteById = (id, options = {}) =>
  Group.findByIdAndDelete(toObjectId(id), options);

export const deleteManyByIds = (ids, options = {}) =>
  Group.deleteMany({ _id: { $in: ids.map(toObjectId) } }, options);

export const deleteMany = (filter, options = {}) =>
  Group.deleteMany(filter, options);

export const bulkWrite = (ops, options = {}) => Group.bulkWrite(ops, options);

export const exists = async (filter, options = {}) => {
  const query = Group.exists(filter);
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

const groupRepository = Object.freeze({
  create,
  createGroup,
  find,
  findMany,
  findOne,
  findById,
  findGroupById,
  loadWithMembers,
  findByMember,
  findByMemberLean,
  findMembershipGroups,
  updateOne,
  findOneAndUpdate,
  updateById,
  deleteOne,
  deleteById,
  deleteManyByIds,
  deleteMany,
  bulkWrite,
  exists,
});

export default groupRepository;
