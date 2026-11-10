import GroupCall from "../../models/group-call.model.js";

export const findForGroupAfter = (groupId, joinedAt, { skip, limit }) =>
  GroupCall.find({
    groupId,
    startedAt: { $gte: joinedAt },
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("startedBy", "fullName avatar profilePhotoVisibility")
    .populate("participants", "fullName avatar profilePhotoVisibility");

export const deleteForGroup = (groupId) => GroupCall.deleteMany({ groupId });

export const findByGroupIds = (groupIds, { skip, limit }) =>
  GroupCall.find({ groupId: { $in: groupIds } })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("startedBy", "fullName avatar profilePhotoVisibility")
    .populate("participants", "fullName avatar profilePhotoVisibility");

export const upsertByCallId = (finalCallId, setOnInsert) =>
  GroupCall.findOneAndUpdate(
    { callId: finalCallId },
    { $setOnInsert: setOnInsert },
    { upsert: true, new: true },
  );

export const findByCallId = (callId) => GroupCall.findOne({ callId });

export const deleteMany = (filter) => GroupCall.deleteMany(filter);
