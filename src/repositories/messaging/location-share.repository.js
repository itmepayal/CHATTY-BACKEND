import LocationShare from "../../models/location-share.model.js";

export const find = (filter) => LocationShare.find(filter);

export const findOne = (filter) => LocationShare.findOne(filter);

export const create = (data) => LocationShare.create(data);

export const updateOne = (filter, update, options) =>
  LocationShare.updateOne(filter, update, options);

export const updateMany = (filter, update, options) =>
  LocationShare.updateMany(filter, update, options);

export const deleteOne = (filter) => LocationShare.deleteOne(filter);

export const deleteMany = (filter, options) =>
  LocationShare.deleteMany(filter, options);

export const findById = (id) => LocationShare.findById(id);
