import Message from "../../models/message.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export const create = async (data, options = {}) => {
  if (options.session) {
    const [doc] = await Message.create([data], { session: options.session });
    return doc;
  }
  return Message.create(data);
};

export const find = (filter = {}, projection, options = {}) => {
  const query = Message.find(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findMany = (filter, projection, options) =>
  find(filter, projection, options);

export const findById = (id, options = {}) => {
  const query = Message.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findByIdSelect = (id, select, options = {}) => {
  const query = Message.findById(toObjectId(id)).select(select);
  if (options.session) query.session(options.session);
  return query;
};

export const findOne = (filter = {}, projection, options = {}) => {
  const query = Message.findOne(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const countDocuments = (filter = {}, options = {}) => {
  const query = Message.countDocuments(filter);
  if (options.session) query.session(options.session);
  return query;
};

export const count = (filter, options) => countDocuments(filter, options);

export const distinct = (field, filter = {}, options = {}) => {
  const query = Message.distinct(field, filter);
  if (options.session) query.session(options.session);
  return query;
};

export const updateOne = (filter, update, options = {}) =>
  Message.updateOne(filter, update, options);

export const updateMany = (filter, update, options = {}) =>
  Message.updateMany(filter, update, options);

export const deleteOne = (filter, options = {}) =>
  Message.deleteOne(filter, options);

export const deleteMany = (filter, options = {}) =>
  Message.deleteMany(filter, options);

export const aggregate = (pipeline, options = {}) => {
  const query = Message.aggregate(pipeline);
  if (options.session) query.session(options.session);
  return query;
};

export const findWithAssets = (filter, select, options = {}) => {
  const query = Message.find(filter).select(select);
  if (options.session) query.session(options.session);
  return query.lean();
};

const messageRepository = Object.freeze({
  create,
  find,
  findMany,
  findById,
  findByIdSelect,
  findOne,
  countDocuments,
  count,
  distinct,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
  aggregate,
  findWithAssets,
});

export default messageRepository;
