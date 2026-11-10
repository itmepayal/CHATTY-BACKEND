import Call from "../../models/call.model.js";

export const findHistoryForUser = (userId, { skip, limit }) =>
  Call.find({
    $or: [{ callerId: userId }, { receiverId: userId }],
  })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("callerId receiverId", "fullName avatar profilePhotoVisibility");

export const upsertByCallId = (finalCallId, setOnInsert) =>
  Call.findOneAndUpdate(
    { callId: finalCallId },
    { $setOnInsert: setOnInsert },
    { upsert: true, new: true },
  );

export const findByCallId = (callId) => Call.findOne({ callId });

export const deleteForUser = (userId, options) =>
  Call.deleteMany(
    { $or: [{ callerId: userId }, { receiverId: userId }] },
    options,
  );
