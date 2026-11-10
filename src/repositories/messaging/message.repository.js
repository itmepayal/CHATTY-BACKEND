import Message from "../../models/message.model.js";

export const find = (filter) => Message.find(filter);

export const findById = (id) => Message.findById(id);

export const findByIdSelect = (id, select) => Message.findById(id).select(select);

export const findOne = (filter) => Message.findOne(filter);

export const create = (data) => Message.create(data);

export const countDocuments = (filter) => Message.countDocuments(filter);

export const distinct = (field, filter) => Message.distinct(field, filter);

export const updateOne = (filter, update, options) =>
  Message.updateOne(filter, update, options);

export const updateMany = (filter, update, options) =>
  Message.updateMany(filter, update, options);

export const deleteMany = (filter, options) =>
  Message.deleteMany(filter, options);

export const aggregate = (pipeline) => Message.aggregate(pipeline);

export const findWithAssets = (filter, select) =>
  Message.find(filter).select(select).lean();
