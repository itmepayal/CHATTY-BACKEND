import ChatSetting from "../../models/chat-setting.model.js";
import ChatArchive from "../../models/chat-archive.model.js";
export {
  ALLOWED_TIMERS,
  pairKeyOf,
  getDisappearAfter,
  getExpiry,
} from "../../models/chat-setting.model.js";
export { getArchivedSet } from "../../models/chat-archive.model.js";

export const upsertDisappear = (filter, update) =>
  ChatSetting.findOneAndUpdate(filter, update, { upsert: true });

export const archiveChat = (ownerId, otherId) =>
  ChatArchive.updateOne(
    { ownerId, otherId },
    { $setOnInsert: { ownerId, otherId } },
    { upsert: true },
  );

export const unarchiveChat = (ownerId, otherId) =>
  ChatArchive.deleteOne({ ownerId, otherId });

export const deleteArchivesForUser = (userId, options) =>
  ChatArchive.deleteMany(
    { $or: [{ ownerId: userId }, { otherId: userId }] },
    options,
  );
