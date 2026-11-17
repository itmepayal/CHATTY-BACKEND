import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import GroupInvite from "../models/group-invite.model.js";
import Group from "../models/group.model.js";
import User from "../../users/models/users.model.js";
import { joinGroupRoom, emitToUser } from "../helpers/group.socket.helpers.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";

export const createGroupInvite = async (groupId, inviterId, inviteeId) => {
  const gId = String(groupId);
  const invId = String(inviterId);
  const tgtId = String(inviteeId);

  const group = await Group.findById(gId);
  if (!group) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Group not found.");
  }

  const isMember = group.members.some((m) => String(m.userId) === invId);
  if (!isMember) {
    throw new ApiError(StatusCodes.FORBIDDEN, "Only group members can send invitations.");
  }

  const isAlreadyMember = group.members.some((m) => String(m.userId) === tgtId);
  if (isAlreadyMember) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User is already in this group.");
  }

  const invitee = await User.findById(tgtId).select("_id fullName");
  if (!invitee) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Target user not found.");
  }

  // Set 3 days expiration
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

  const invite = await GroupInvite.findOneAndUpdate(
    { groupId: gId, inviteeId: tgtId, status: "pending" },
    { inviterId: invId, expiresAt, status: "pending" },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).populate("groupId", "name avatar");

  emitToUser(tgtId, "group:invite-received", {
    inviteId: String(invite._id),
    groupId: gId,
    groupName: group.name,
    groupAvatar: group.avatar?.url || group.avatar || "",
    inviterId: invId,
    expiresAt,
  });

  return invite;
};

export const getMyGroupInvites = async (userId) => {
  const now = new Date();
  const invites = await GroupInvite.find({
    inviteeId: userId,
    status: "pending",
    expiresAt: { $gt: now },
  })
    .populate("groupId", "name avatar description members")
    .populate("inviterId", "fullName username avatar")
    .sort({ createdAt: -1 })
    .lean();

  return invites.map((inv) => ({
    id: String(inv._id),
    _id: inv._id,
    groupId: inv.groupId?._id,
    groupName: inv.groupId?.name || "Group",
    groupAvatar: inv.groupId?.avatar?.url || inv.groupId?.avatar || "",
    memberCount: inv.groupId?.members?.length || 0,
    inviter: {
      id: inv.inviterId?._id,
      fullName: inv.inviterId?.fullName || "User",
      username: inv.inviterId?.username || "",
      avatar: inv.inviterId?.avatar?.url || inv.inviterId?.avatar || "",
    },
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  }));
};

export const acceptGroupInvite = async (inviteId, userId) => {
  const inv = await GroupInvite.findById(inviteId);
  if (!inv) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Invitation not found.");
  }

  if (String(inv.inviteeId) !== String(userId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "This invitation is not for you.");
  }

  if (inv.status !== "pending" || inv.expiresAt < new Date()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "This invitation has expired or was already used.");
  }

  const group = await Group.findById(inv.groupId);
  if (!group) {
    throw new ApiError(StatusCodes.NOT_FOUND, "The group no longer exists.");
  }

  const isAlreadyMember = group.members.some((m) => String(m.userId) === String(userId));
  if (!isAlreadyMember) {
    group.members.push({
      userId,
      role: "member",
      joinedAt: new Date(),
    });
    await group.save();
  }

  inv.status = "accepted";
  await inv.save();

  joinGroupRoom(userId, group._id);

  emitToUser(String(userId), "group:joined", {
    groupId: String(group._id),
    name: group.name,
  });

  return { success: true, groupId: group._id, groupName: group.name };
};

export const declineGroupInvite = async (inviteId, userId) => {
  const inv = await GroupInvite.findById(inviteId);
  if (!inv) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Invitation not found.");
  }

  if (String(inv.inviteeId) !== String(userId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "This invitation is not for you.");
  }

  inv.status = "declined";
  await inv.save();

  return { success: true, message: "Invitation declined." };
};
