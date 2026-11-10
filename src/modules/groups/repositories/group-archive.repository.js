import GroupArchive from "../models/group-archive.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export { getArchivedGroupSet } from "../models/group-archive.model.js";

export const exists = async (filter, options = {}) => {
  const query = GroupArchive.exists(filter);
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

export const updateOne = (filter, update, options = {}) =>
  GroupArchive.updateOne(filter, update, options);

export const upsert = (ownerId, groupId, options = {}) =>
  GroupArchive.updateOne(
    { ownerId: toObjectId(ownerId), groupId: toObjectId(groupId) },
    {
      $setOnInsert: {
        ownerId: toObjectId(ownerId),
        groupId: toObjectId(groupId),
      },
    },
    { upsert: true, ...options },
  );

export const deleteOne = (filter, options = {}) =>
  GroupArchive.deleteOne(filter, options);

export const deleteMany = (filter, options = {}) =>
  GroupArchive.deleteMany(filter, options);

const groupArchiveRepository = Object.freeze({
  exists,
  updateOne,
  upsert,
  deleteOne,
  deleteMany,
});

export default groupArchiveRepository;
