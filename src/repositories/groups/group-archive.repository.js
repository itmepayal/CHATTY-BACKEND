import GroupArchive from "../../models/group-archive.model.js";
export { getArchivedGroupSet } from "../../models/group-archive.model.js";

export const exists = (filter) => GroupArchive.exists(filter);

export const updateOne = (filter, update, options) =>
  GroupArchive.updateOne(filter, update, options);

export const upsert = (ownerId, groupId) =>
  GroupArchive.updateOne(
    { ownerId, groupId },
    { $setOnInsert: { ownerId, groupId } },
    { upsert: true },
  );

export const deleteOne = (filter) => GroupArchive.deleteOne(filter);

export const deleteMany = (filter, options) =>
  GroupArchive.deleteMany(filter, options);
