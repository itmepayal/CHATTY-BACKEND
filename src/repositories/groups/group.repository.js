import Group from "../../models/group.model.js";

export const find = (filter) => Group.find(filter);

export const findById = (id) => Group.findById(id);

export const loadWithMembers = (id) =>
  Group.findById(id).populate(
    "members.userId",
    "fullName avatar profilePhotoVisibility",
  );

export const findByMember = (me) =>
  Group.find({ "members.userId": me }).populate(
    "members.userId",
    "fullName avatar profilePhotoVisibility",
  );

export const updateOne = (filter, update, options) =>
  Group.updateOne(filter, update, options);

export const deleteOne = (filter) => Group.deleteOne(filter);

export const deleteManyByIds = (ids, options) =>
  Group.deleteMany({ _id: { $in: ids } }, options);

export const findMembershipGroups = (userId) =>
  Group.find({ "members.userId": userId });

export const findByMemberLean = (me, select) =>
  Group.find({ "members.userId": me }).select(select).lean();

export const create = (data) => Group.create(data);

export const findOneAndUpdate = (filter, update, options) =>
  Group.findOneAndUpdate(filter, update, options);

export const bulkWrite = (ops, options) => Group.bulkWrite(ops, options);
