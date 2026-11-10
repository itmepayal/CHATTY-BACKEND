import ScheduledMessage from "../models/scheduled-message.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const create = async (data, options = {}) => {
  if (options.session) {
    const [doc] = await ScheduledMessage.create([data], {
      session: options.session,
    });
    return doc;
  }
  return ScheduledMessage.create(data);
};

export const findSorted = (filter, options = {}) => {
  const query = ScheduledMessage.find(filter).sort({ scheduledFor: 1 });
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findById = (id, options = {}) => {
  const query = ScheduledMessage.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findOneAndUpdate = (filter, update, options = {}) =>
  ScheduledMessage.findOneAndUpdate(filter, update, options);

export const deleteForSender = (senderId, options = {}) =>
  ScheduledMessage.deleteMany({ senderId: toObjectId(senderId) }, options);

export const deleteOne = (filter, options = {}) =>
  ScheduledMessage.deleteOne(filter, options);

export const deleteMany = (filter, options = {}) =>
  ScheduledMessage.deleteMany(filter, options);

const scheduledMessageRepository = Object.freeze({
  create,
  findSorted,
  findById,
  findOneAndUpdate,
  deleteForSender,
  deleteOne,
  deleteMany,
});

export default scheduledMessageRepository;
