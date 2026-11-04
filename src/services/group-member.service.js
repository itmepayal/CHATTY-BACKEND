import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import Group from "../models/group.model.js";
import GroupKey from "../models/group-key.model.js";
import GroupArchive from "../models/group-archive.model.js";
import { io } from "../lib/socket.js";
import { assertAdmin, assertUsersAddable } from "../utils/group-guard.js";
import { parseIds } from "../utils/validators.js";
import { MAX_GROUP_MEMBERS } from "../constants/constants.js";
import { assertCanAddToGroup } from "./privacy-visibility.service.js";
import {
  sid,
  getLatestKeyVersion,
  storeGroupKeys,
  requestKeyRotation,
  notifyKeysNeeded,
  loadGroup,
  presentGroup,
  emitToMembers,
  emitGroupToMembers,
  joinRoom,
  leaveRoom,
  stopUserShares,
  destroyGroup,
} from "./group.service.js";

export const createGroupWithMembers = async ({
  me,
  name,
  memberIds,
  avatar,
  wantsE2EE,
  keyEntries,
}) => {
  // groupAddPermission check (creator ko members add karne se pehle)
  await assertCanAddToGroup(me, memberIds);

  const created = await Group.create({
    name,
    avatar,
    owner: me,
    members: [
      { userId: me, role: "admin" },
      ...memberIds.map((userId) => ({ userId, role: "member" })),
    ],
    lastMessageAt: new Date(),
    keyVersion: wantsE2EE ? 1 : 0,
  });

  if (wantsE2EE) {
    try {
      await storeGroupKeys(created._id, keyEntries, me);
    } catch (error) {
      await Group.deleteOne({ _id: created._id });
      throw error;
    }
  }

  [String(me), ...memberIds].forEach((id) => joinRoom(id, created._id));

  const group = await loadGroup(created._id);
  await emitGroupToMembers(group, "group:created");

  return presentGroup(group, {}, me);
};

export const addMembersToGroup = async ({ group, me, rawMemberIds }) => {
  const existing = new Set(group.members.map((m) => sid(m.userId)));
  const newIds = parseIds(rawMemberIds).filter((id) => !existing.has(id));

  if (!newIds.length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "No new members to add.");
  }
  if (group.members.length + newIds.length > MAX_GROUP_MEMBERS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `A group can have at most ${MAX_GROUP_MEMBERS} members.`,
    );
  }
  await assertUsersAddable(me, newIds);

  // groupAddPermission check
  await assertCanAddToGroup(me, newIds);

  const joinedAt = new Date();
  group.members.push(
    ...newIds.map((userId) => ({ userId, role: "member", joinedAt })),
  );
  await group.save();

  newIds.forEach((id) => joinRoom(id, group._id));

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, "group:created", [...existing]);
  await emitGroupToMembers(full, "group:updated", newIds);

  await notifyKeysNeeded(full, newIds);

  return presentGroup(full, {}, me);
};

export const removeMemberFromGroup = async ({ group, me, targetId }) => {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }
  if (targetId === String(me)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Use 'leave group' to remove yourself.",
    );
  }

  const target = group.members.find((m) => sid(m.userId) === targetId);
  if (!target)
    throw new ApiError(StatusCodes.NOT_FOUND, "User is not in this group.");

  if (targetId === sid(group.owner)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "The group owner can't be removed.",
    );
  }
  if (target.role === "admin" && sid(group.owner) !== String(me)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only the owner can remove an admin.",
    );
  }

  await stopUserShares(group, targetId);

  group.members = group.members.filter((m) => sid(m.userId) !== targetId);
  if (await getLatestKeyVersion(group._id)) group.keyRotationPending = true;
  await group.save();
  await GroupArchive.deleteOne({ ownerId: targetId, groupId: group._id });
  await GroupKey.deleteMany({ groupId: group._id, userId: targetId });

  leaveRoom(targetId, group._id);
  io.to(targetId).emit("group:removed", {
    groupId: String(group._id),
    reason: "removed",
  });

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, "group:updated");

  await requestKeyRotation(group, "member_removed");

  return presentGroup(full, {}, me);
};

export const changeMemberRole = async ({ group, me, targetId, role }) => {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }
  if (!["admin", "member"].includes(role)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Role must be 'admin' or 'member'.",
    );
  }
  const target = group.members.find((m) => sid(m.userId) === targetId);
  if (!target)
    throw new ApiError(StatusCodes.NOT_FOUND, "User is not in this group.");

  if (targetId === sid(group.owner)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "The owner's role can't be changed.",
    );
  }
  if (targetId === String(me)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You can't change your own role.",
    );
  }
  if (
    role === "member" &&
    target.role === "admin" &&
    sid(group.owner) !== String(me)
  ) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only the owner can demote an admin.",
    );
  }

  target.role = role;
  await group.save();

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, "group:updated");

  return presentGroup(full, {}, me);
};

export const leaveGroupFlow = async ({ group, me }) => {
  await stopUserShares(group, me);

  group.members = group.members.filter((m) => sid(m.userId) !== me);

  if (group.members.length === 0) {
    await destroyGroup(group);
    leaveRoom(me, group._id);
    io.to(me).emit("group:removed", {
      groupId: String(group._id),
      reason: "left",
    });
    return { destroyed: true };
  }

  const byJoin = [...group.members].sort((a, b) => a.joinedAt - b.joinedAt);
  if (!group.members.some((m) => m.role === "admin")) byJoin[0].role = "admin";
  if (sid(group.owner) === me) {
    group.owner = byJoin.find((m) => m.role === "admin").userId;
  }
  if (await getLatestKeyVersion(group._id)) group.keyRotationPending = true;
  await group.save();
  await GroupArchive.deleteOne({ ownerId: me, groupId: group._id });
  await GroupKey.deleteMany({ groupId: group._id, userId: me });

  leaveRoom(me, group._id);
  io.to(me).emit("group:removed", {
    groupId: String(group._id),
    reason: "left",
  });

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, "group:updated");

  await requestKeyRotation(group, "member_left");

  return { destroyed: false };
};
