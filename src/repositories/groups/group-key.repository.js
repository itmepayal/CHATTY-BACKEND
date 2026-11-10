import GroupKey from "../../models/group-key.model.js";

export const findLatestVersion = (groupId) =>
  GroupKey.findOne({ groupId }).sort({ version: -1 }).select("version").lean();

export const aggregateLatestVersions = (groupIds) =>
  GroupKey.aggregate([
    { $match: { groupId: { $in: groupIds } } },
    { $group: { _id: "$groupId", maxVersion: { $max: "$version" } } },
  ]);

export const bulkWriteKeys = (ops) => GroupKey.bulkWrite(ops, { ordered: false });

export const existsForUserVersion = ({ groupId, userId, version }) =>
  GroupKey.exists({ groupId, userId, version });

export const findForUser = (groupId, userId) =>
  GroupKey.find({ groupId, userId }).sort({ version: 1 }).lean();

export const findVersionsForGroup = (groupId) =>
  GroupKey.find({ groupId }).select("userId version").lean();

export const deleteForUser = (userId, options) =>
  GroupKey.deleteMany({ userId }, options);

export const deleteForUserOrGroups = (filter, options) =>
  GroupKey.deleteMany(filter, options);

export const deleteForGroup = (groupId) => GroupKey.deleteMany({ groupId });

export const find = (filter) => GroupKey.find(filter);

export const findOne = (filter) => GroupKey.findOne(filter);

export const exists = (filter) => GroupKey.exists(filter);

export const aggregate = (pipeline) => GroupKey.aggregate(pipeline);

export const bulkWrite = (ops, options) => GroupKey.bulkWrite(ops, options);

export const deleteMany = (filter, options) =>
  GroupKey.deleteMany(filter, options);
