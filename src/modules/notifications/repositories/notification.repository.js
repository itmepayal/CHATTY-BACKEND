import Notification from "../models/notification.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const create = async (data) => {
  return Notification.create(data);
};

export const findByRecipient = async (
  recipientId,
  { skip = 0, limit = 20, isRead, category, search } = {},
) => {
  const filter = { recipientId: toObjectId(recipientId) };

  if (typeof isRead === "boolean") {
    filter.isRead = isRead;
  }

  if (category && category !== "all") {
    filter.category = category;
  }

  if (search && typeof search === "string" && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [{ title: regex }, { body: regex }];
  }

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip(Number(skip) || 0)
      .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
      .populate("senderId", "fullName username avatar profilePic")
      .lean(),
    Notification.countDocuments(filter),
  ]);

  return { items, total };
};

export const countUnread = async (recipientId, category = null) => {
  const filter = {
    recipientId: toObjectId(recipientId),
    isRead: false,
  };
  if (category && category !== "all") {
    filter.category = category;
  }
  return Notification.countDocuments(filter);
};

export const countUnreadByCategory = async (recipientId) => {
  const counts = await Notification.aggregate([
    {
      $match: {
        recipientId: toObjectId(recipientId),
        isRead: false,
      },
    },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
      },
    },
  ]);

  const map = {
    message: 0,
    group: 0,
    call: 0,
    contact: 0,
    security: 0,
    system: 0,
  };

  for (const c of counts) {
    if (c._id && map[c._id] !== undefined) {
      map[c._id] = c.count;
    }
  }

  return map;
};

export const markRead = async (recipientId, notificationId) => {
  return Notification.findOneAndUpdate(
    {
      _id: toObjectId(notificationId),
      recipientId: toObjectId(recipientId),
    },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  ).lean();
};

export const markAllRead = async (recipientId, category = null) => {
  const filter = {
    recipientId: toObjectId(recipientId),
    isRead: false,
  };
  if (category && category !== "all") {
    filter.category = category;
  }
  return Notification.updateMany(filter, {
    $set: { isRead: true, readAt: new Date() },
  });
};

export const deleteById = async (recipientId, notificationId) => {
  return Notification.findOneAndDelete({
    _id: toObjectId(notificationId),
    recipientId: toObjectId(recipientId),
  });
};

export const deleteAll = async (recipientId, category = null) => {
  const filter = { recipientId: toObjectId(recipientId) };
  if (category && category !== "all") {
    filter.category = category;
  }
  return Notification.deleteMany(filter);
};

export const findRecentDuplicate = async (
  recipientId,
  type,
  senderId,
  windowMs = 3000,
  dedupKey = null,
) => {
  if (dedupKey) {
    const existing = await Notification.findOne({ dedupKey }).lean();
    if (existing) return existing;
  }

  const since = new Date(Date.now() - windowMs);
  const filter = {
    recipientId: toObjectId(recipientId),
    type,
    createdAt: { $gte: since },
  };
  if (senderId) {
    filter.senderId = toObjectId(senderId);
  }
  return Notification.findOne(filter).lean();
};
