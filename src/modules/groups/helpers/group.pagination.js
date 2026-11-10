import GroupMessage from "../models/group-message.model.js";

export const getUnread = (groupId, userId, joinedAt, blockedIds = []) =>
  GroupMessage.countDocuments({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: [...blockedIds, userId] },
    readBy: { $ne: userId },
    silentReadBy: { $ne: userId },
  });

export const getLast = (groupId, joinedAt, blockedIds = []) =>
  GroupMessage.findOne({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: blockedIds },
  })
    .sort({ createdAt: -1 })
    .populate("senderId", "fullName avatar profilePhotoVisibility");
