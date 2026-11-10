import ChatSetting from "../../models/chat-setting.model.js";
import ChatArchive from "../../models/chat-archive.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export {
  ALLOWED_TIMERS,
  pairKeyOf,
  getDisappearAfter,
  getExpiry,
} from "../../models/chat-setting.model.js";
export { getArchivedSet } from "../../models/chat-archive.model.js";

export const upsertDisappear = (filter, update, options = {}) =>
  ChatSetting.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    ...options,
  });

export const archiveChat = (ownerId, otherId, options = {}) =>
  ChatArchive.updateOne(
    { ownerId: toObjectId(ownerId), otherId: toObjectId(otherId) },
    {
      $setOnInsert: {
        ownerId: toObjectId(ownerId),
        otherId: toObjectId(otherId),
      },
    },
    { upsert: true, ...options },
  );

export const unarchiveChat = (ownerId, otherId, options = {}) =>
  ChatArchive.deleteOne(
    { ownerId: toObjectId(ownerId), otherId: toObjectId(otherId) },
    options,
  );

export const deleteArchivesForUser = (userId, options = {}) => {
  const uid = toObjectId(userId);
  return ChatArchive.deleteMany(
    { $or: [{ ownerId: uid }, { otherId: uid }] },
    options,
  );
};

const chatSettingRepository = Object.freeze({
  upsertDisappear,
  archiveChat,
  unarchiveChat,
  deleteArchivesForUser,
});

export default chatSettingRepository;
