import ScheduledMessage from "../../models/scheduled-message.model.js";

export const create = (data) => ScheduledMessage.create(data);

export const findSorted = (filter) =>
  ScheduledMessage.find(filter).sort({ scheduledFor: 1 });

export const findOneAndUpdate = (filter, update, options) =>
  ScheduledMessage.findOneAndUpdate(filter, update, options);

export const deleteForSender = (senderId, options) =>
  ScheduledMessage.deleteMany({ senderId }, options);
