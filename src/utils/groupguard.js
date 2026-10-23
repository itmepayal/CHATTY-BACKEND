import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "./apiError.js";
import Group from "../models/group.model.js";
import User from "../models/users.model.js";

export const getGroupAndMember = async (groupId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(groupId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid group ID.");
  }
  const group = await Group.findById(groupId);
  if (!group) throw new ApiError(StatusCodes.NOT_FOUND, "Group not found.");

  const member = group.members.find((m) => String(m.userId) === String(userId));
  if (!member) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not a member of this group.",
    );
  }
  return { group, member };
};

export const assertAdmin = (member) => {
  if (member.role !== "admin") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only group admins can do this.");
  }
};

export const getBlockedByMe = async (userId) => {
  const me = await User.findById(userId).select("blockedUsers").lean();
  return me?.blockedUsers || [];
};

export const getBlockersOf = async (memberIds, senderId) => {
  const rows = await User.find({
    _id: { $in: memberIds },
    blockedUsers: senderId,
  })
    .select("_id")
    .lean();
  return new Set(rows.map((u) => String(u._id)));
};

export const assertUsersAddable = async (actorId, targetIds) => {
  const count = await User.countDocuments({ _id: { $in: targetIds } });
  if (count !== targetIds.length) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "One or more users were not found.",
    );
  }

  const [actor, blockers] = await Promise.all([
    User.findById(actorId).select("blockedUsers").lean(),
    User.find({ _id: { $in: targetIds }, blockedUsers: actorId })
      .select("_id")
      .lean(),
  ]);

  const bad = new Set([
    ...(actor?.blockedUsers || []).map(String),
    ...blockers.map((u) => String(u._id)),
  ]);
  if (targetIds.some((id) => bad.has(String(id)))) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You can't add one or more of these users.",
    );
  }
};
