import GroupKey from "../models/group-key.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const findLatestVersion = (groupId, options = {}) => {
  const query = GroupKey.findOne({ groupId: toObjectId(groupId) })
    .sort({ version: -1 })
    .select("version");
  if (options.session) query.session(options.session);
  return query.lean();
};

export const aggregateLatestVersions = (groupIds, options = {}) => {
  const query = GroupKey.aggregate([
    { $match: { groupId: { $in: groupIds.map(toObjectId) } } },
    { $group: { _id: "$groupId", maxVersion: { $max: "$version" } } },
  ]);
  if (options.session) query.session(options.session);
  return query;
};

export const bulkWriteKeys = (ops, options = { ordered: false }) =>
  GroupKey.bulkWrite(ops, options);

export const bulkWrite = (ops, options) => GroupKey.bulkWrite(ops, options);

export const existsForUserVersion = async (
  { groupId, userId, version },
  options = {},
) => {
  const query = GroupKey.exists({
    groupId: toObjectId(groupId),
    userId: toObjectId(userId),
    version,
  });
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

export const findForUser = (groupId, userId, options = {}) => {
  const query = GroupKey.find({
    groupId: toObjectId(groupId),
    userId: toObjectId(userId),
  }).sort({ version: 1 });
  if (options.session) query.session(options.session);
  return query.lean();
};

export const findVersionsForGroup = (groupId, options = {}) => {
  const query = GroupKey.find({ groupId: toObjectId(groupId) }).select(
    "userId version",
  );
  if (options.session) query.session(options.session);
  return query.lean();
};

export const deleteForUser = (userId, options = {}) =>
  GroupKey.deleteMany({ userId: toObjectId(userId) }, options);

export const deleteForUserOrGroups = (filter, options = {}) =>
  GroupKey.deleteMany(filter, options);

export const deleteForGroup = (groupId, options = {}) =>
  GroupKey.deleteMany({ groupId: toObjectId(groupId) }, options);

export const find = (filter = {}, projection, options = {}) => {
  const query = GroupKey.find(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findOne = (filter = {}, projection, options = {}) => {
  const query = GroupKey.findOne(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const exists = async (filter, options = {}) => {
  const query = GroupKey.exists(filter);
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

export const aggregate = (pipeline, options = {}) => {
  const query = GroupKey.aggregate(pipeline);
  if (options.session) query.session(options.session);
  return query;
};

export const deleteMany = (filter, options = {}) =>
  GroupKey.deleteMany(filter, options);

const groupKeyRepository = Object.freeze({
  findLatestVersion,
  aggregateLatestVersions,
  bulkWriteKeys,
  bulkWrite,
  existsForUserVersion,
  findForUser,
  findVersionsForGroup,
  deleteForUser,
  deleteForUserOrGroups,
  deleteForGroup,
  find,
  findOne,
  exists,
  aggregate,
  deleteMany,
});

export default groupKeyRepository;
