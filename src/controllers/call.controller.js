import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import Call from "../models/call.model.js";
import User from "../models/users.model.js";
import Contact from "../models/contact.model.js";
import ApiResponse from "../utils/api-response.js";
import { canViewSync } from "../services/privacy-visibility.service.js";

const callController = {
  getCallHistory: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const calls = await Call.find({
      $or: [{ callerId: userId }, { receiverId: userId }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate(
        "callerId receiverId",
        "fullName avatar profilePhotoVisibility",
      );

    const otherUserIds = [];
    for (const c of calls) {
      const cId = c.callerId?._id
        ? String(c.callerId._id)
        : c.callerId
          ? String(c.callerId)
          : null;
      const rId = c.receiverId?._id
        ? String(c.receiverId._id)
        : c.receiverId
          ? String(c.receiverId)
          : null;
      const isCallerMe = cId === String(userId);
      const otherId = isCallerMe ? rId : cId;
      if (otherId && otherId !== String(userId)) otherUserIds.push(otherId);
    }

    const [savedContacts, blockers, meDoc] = await Promise.all([
      Contact.find({ ownerId: { $in: otherUserIds }, contactId: userId })
        .select("ownerId")
        .lean(),
      User.find({ _id: { $in: otherUserIds }, blockedUsers: userId })
        .select("_id")
        .lean(),
      User.findById(userId).select("blockedUsers").lean(),
    ]);

    const targetSavedViewerSet = new Set(
      savedContacts.map((c) => String(c.ownerId)),
    );
    const blockedSet = new Set([
      ...blockers.map((b) => String(b._id)),
      ...(meDoc?.blockedUsers || []).map(String),
    ]);

    const data = calls.map((c) => {
      const callerIdStr = c.callerId?._id
        ? String(c.callerId._id)
        : c.callerId
          ? String(c.callerId)
          : null;
      const isOutgoing = callerIdStr === String(userId);
      const other = isOutgoing ? c.receiverId : c.callerId;
      const otherIdStr = other?._id
        ? String(other._id)
        : other
          ? String(other)
          : null;

      let otherUserPayload = {
        id: otherIdStr,
        fullName: other?.fullName || "Deleted User",
        avatar: "",
      };

      if (other && other._id) {
        const isBlocked = blockedSet.has(otherIdStr);
        const inContacts = targetSavedViewerSet.has(otherIdStr);
        const canSeePhoto =
          !isBlocked &&
          canViewSync(
            other.profilePhotoVisibility ?? "everyone",
            otherIdStr,
            userId,
            inContacts,
          );
        otherUserPayload = {
          id: other._id,
          fullName: other.fullName || "User",
          avatar: canSeePhoto ? other.avatar?.url || "" : "",
        };
      }

      return {
        id: c._id,
        direction: isOutgoing ? "outgoing" : "incoming",
        type: c.type,
        status: c.status,
        duration: c.duration,
        startedAt: c.startedAt,
        user: otherUserPayload,
      };
    });

    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Call history fetched successfully.",
    ).send(res);
  }),
};

export default callController;
