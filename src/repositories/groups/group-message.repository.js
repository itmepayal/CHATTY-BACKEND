import GroupMessage from "../../models/group-message.model.js";

export const find = (filter) => GroupMessage.find(filter);

export const findOne = (filter) => GroupMessage.findOne(filter);

export const countDocuments = (filter) => GroupMessage.countDocuments(filter);

export const updateOne = (filter, update, options) =>
  GroupMessage.updateOne(filter, update, options);

export const updateMany = (filter, update, options) =>
  GroupMessage.updateMany(filter, update, options);

export const deleteMany = (filter, options) =>
  GroupMessage.deleteMany(filter, options);

export const findWithAssets = (filter, select) =>
  GroupMessage.find(filter).select(select).lean();

export const create = (data) => GroupMessage.create(data);

export const findById = (id) => GroupMessage.findById(id);

export const findOneAndUpdate = (filter, update, options) =>
  GroupMessage.findOneAndUpdate(filter, update, options);

export const deleteOne = (filter) => GroupMessage.deleteOne(filter);
