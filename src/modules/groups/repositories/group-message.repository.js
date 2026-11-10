import GroupMessage from "../models/group-message.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const create = async (data, options = {}) => {
  if (options.session) {
    const [doc] = await GroupMessage.create([data], {
      session: options.session,
    });
    return doc;
  }
  return GroupMessage.create(data);
};

export const createGroupMessage = (data, options) => create(data, options);

export const find = (filter = {}, projection, options = {}) => {
  const query = GroupMessage.find(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findMany = (filter, projection, options) =>
  find(filter, projection, options);

export const findOne = (filter = {}, projection, options = {}) => {
  const query = GroupMessage.findOne(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findById = (id, options = {}) => {
  const query = GroupMessage.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findGroupMessageById = (id, options) =>
  findById(id, options).lean();

export const countDocuments = (filter = {}, options = {}) => {
  const query = GroupMessage.countDocuments(filter);
  if (options.session) query.session(options.session);
  return query;
};

export const count = (filter, options) => countDocuments(filter, options);

export const updateOne = (filter, update, options = {}) =>
  GroupMessage.updateOne(filter, update, options);

export const updateMany = (filter, update, options = {}) =>
  GroupMessage.updateMany(filter, update, options);

export const findOneAndUpdate = (filter, update, options = {}) =>
  GroupMessage.findOneAndUpdate(filter, update, options);

export const updateById = async (id, update, options = { new: true }) => {
  const query = GroupMessage.findByIdAndUpdate(toObjectId(id), update, {
    new: true,
    runValidators: true,
    ...options,
  });
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const deleteOne = (filter, options = {}) =>
  GroupMessage.deleteOne(filter, options);

export const deleteById = (id, options = {}) =>
  GroupMessage.findByIdAndDelete(toObjectId(id), options);

export const deleteMany = (filter, options = {}) =>
  GroupMessage.deleteMany(filter, options);

export const findWithAssets = (filter, select, options = {}) => {
  const query = GroupMessage.find(filter).select(select);
  if (options.session) query.session(options.session);
  return query.lean();
};

export const exists = async (filter, options = {}) => {
  const query = GroupMessage.exists(filter);
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

const groupMessageRepository = Object.freeze({
  create,
  createGroupMessage,
  find,
  findMany,
  findOne,
  findById,
  findGroupMessageById,
  countDocuments,
  count,
  updateOne,
  updateMany,
  findOneAndUpdate,
  updateById,
  deleteOne,
  deleteById,
  deleteMany,
  findWithAssets,
  exists,
});

export default groupMessageRepository;
