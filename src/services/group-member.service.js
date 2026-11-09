import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import Group from "../models/group.model.js";
import GroupKey from "../models/group-key.model.js";
import GroupArchive from "../models/group-archive.model.js";
import LocationShare from "../models/location-share.model.js";
import { assertUsersAddable } from "../utils/group-guard.js";
import { parseIds } from "../utils/validators.js";
import { parseBool, parseKeyEntries } from "../utils/e2ee.js";
import {
  MAX_GROUP_MEMBERS,
  GROUP_ERROR_MESSAGES,
} from "../constants/group.constants.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";
import { assertCanAddToGroup } from "./privacy-visibility.service.js";
import {
  canRemoveMember,
  canChangeMemberRole,
} from "../policies/group.policy.js";
import { deleteFileToCloudinary } from "../config/cloudinary.config.js";
import { uploadImage } from "./group-media.service.js";
import { validateInitialKeyEntries } from "./group-key.service.js";
import {
  joinGroupRoom,
  leaveGroupRoom,
  broadcastGroupRemoved,
} from "../events/group.events.js";
import {
  sid,
  getLatestKeyVersion,
  storeGroupKeys,
  requestKeyRotation,
  notifyKeysNeeded,
  loadGroup,
  presentGroup,
  emitGroupToMembers,
  stopUserShares,
  destroyGroup,
  safeUnlink,
} from "./group.service.js";

export const createGroupWithMembers = async ({
  me,
  name,
  rawMemberIds,
  memberIds,
  file,
  avatar: initialAvatar,
  e2ee,
  wantsE2EE: initialWantsE2EE,
  keys,
  keyEntries: initialKeyEntries,
}) => {
  const meId = String(me);
  const parsedIds = memberIds || parseIds(rawMemberIds);
  const dedupedMemberIds = [...new Set(parsedIds.map(String))].filter(
    (id) => id !== meId,
  );

  if (1 + dedupedMemberIds.length > MAX_GROUP_MEMBERS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.EXCEEDED_MEMBER_LIMIT,
    );
  }

  const wantsE2EE =
    initialWantsE2EE !== undefined
      ? Boolean(initialWantsE2EE)
      : parseBool(e2ee);
  let keyEntries = initialKeyEntries || [];
  if (wantsE2EE && (!keyEntries || keyEntries.length === 0)) {
    keyEntries = parseKeyEntries(keys, 1);
    validateInitialKeyEntries({
      keyEntries,
      me: meId,
      memberIds: dedupedMemberIds,
    });
  }

  await assertUsersAddable(meId, dedupedMemberIds);
  await assertCanAddToGroup(meId, dedupedMemberIds);

  let avatar = initialAvatar;
  try {
    if (file?.path) {
      avatar = await uploadImage(file);
    }

    const created = await Group.create({
      name,
      avatar,
      owner: meId,
      members: [
        { userId: meId, role: "admin" },
        ...dedupedMemberIds.map((userId) => ({ userId, role: "member" })),
      ],
      lastMessageAt: new Date(),
      keyVersion: wantsE2EE ? 1 : 0,
    });

    if (wantsE2EE) {
      try {
        await storeGroupKeys(created._id, keyEntries, meId);
      } catch (error) {
        await Group.deleteOne({ _id: created._id });
        throw error;
      }
    }

    [meId, ...dedupedMemberIds].forEach((id) => joinGroupRoom(id, created._id));

    const group = await loadGroup(created._id);
    await emitGroupToMembers(group, GROUP_SOCKET_EVENTS.GROUP_CREATED);

    return presentGroup(group, {}, meId);
  } catch (error) {
    if (avatar?.public_id) {
      await deleteFileToCloudinary(avatar.public_id, "image").catch(() => {});
    }
    throw error;
  } finally {
    if (file?.path) {
      await safeUnlink(file.path);
    }
  }
};

export const addMembersToGroup = async ({ group, me, rawMemberIds }) => {
  const meId = String(me);
  const existing = new Set(group.members.map((m) => sid(m.userId)));
  const newIds = parseIds(rawMemberIds).filter(
    (id) => !existing.has(id) && id !== meId,
  );

  if (!newIds.length) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.NO_NEW_MEMBERS,
    );
  }
  if (group.members.length + newIds.length > MAX_GROUP_MEMBERS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.EXCEEDED_MEMBER_LIMIT,
    );
  }

  await assertUsersAddable(meId, newIds);
  await assertCanAddToGroup(meId, newIds);

  const joinedAt = new Date();
  group.members.push(
    ...newIds.map((userId) => ({ userId, role: "member", joinedAt })),
  );
  await group.save();

  newIds.forEach((id) => joinGroupRoom(id, group._id));

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, GROUP_SOCKET_EVENTS.GROUP_CREATED, [
    ...existing,
  ]);
  await emitGroupToMembers(full, GROUP_SOCKET_EVENTS.GROUP_UPDATED, newIds);

  await notifyKeysNeeded(full, newIds);

  return presentGroup(full, {}, meId);
};

export const removeMemberFromGroup = async ({ group, me, targetId }) => {
  const meId = String(me);
  const tId = String(targetId);

  if (!mongoose.Types.ObjectId.isValid(tId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }

  const member = group.members.find((m) => sid(m.userId) === meId);
  canRemoveMember({ group, actorId: meId, targetId: tId, member });

  await stopUserShares(group, tId);

  group.members = group.members.filter((m) => sid(m.userId) !== tId);
  if (await getLatestKeyVersion(group._id)) group.keyRotationPending = true;
  await group.save();

  await Promise.all([
    LocationShare.updateMany(
      { groupId: group._id, sharerId: tId, status: "active" },
      { $set: { status: "stopped", endedAt: new Date() } },
    ),
    GroupArchive.deleteMany({ ownerId: tId, groupId: group._id }),
    GroupKey.deleteMany({ groupId: group._id, userId: tId }),
  ]);

  leaveGroupRoom(tId, group._id);
  broadcastGroupRemoved(tId, {
    groupId: String(group._id),
    reason: "removed",
  });

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, GROUP_SOCKET_EVENTS.GROUP_UPDATED);

  await requestKeyRotation(group, "member_removed");

  return presentGroup(full, {}, meId);
};

export const changeMemberRole = async ({ group, me, targetId, role }) => {
  const meId = String(me);
  const tId = String(targetId);

  if (!mongoose.Types.ObjectId.isValid(tId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }

  const member = group.members.find((m) => sid(m.userId) === meId);
  canChangeMemberRole({
    group,
    actorId: meId,
    targetId: tId,
    newRole: role,
    member,
  });

  const target = group.members.find((m) => sid(m.userId) === tId);
  target.role = role;
  await group.save();

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, GROUP_SOCKET_EVENTS.GROUP_UPDATED);

  return presentGroup(full, {}, meId);
};

export const leaveGroupFlow = async ({ group, me }) => {
  const meId = String(me);
  await stopUserShares(group, meId);

  group.members = group.members.filter((m) => sid(m.userId) !== meId);

  if (group.members.length === 0) {
    await destroyGroup(group);
    leaveGroupRoom(meId, group._id);
    broadcastGroupRemoved(meId, {
      groupId: String(group._id),
      reason: "left",
    });
    return { destroyed: true };
  }

  const byJoin = [...group.members].sort((a, b) => a.joinedAt - b.joinedAt);
  if (!group.members.some((m) => m.role === "admin")) {
    byJoin[0].role = "admin";
  }
  if (sid(group.owner) === meId) {
    const nextAdmin = byJoin.find((m) => m.role === "admin");
    group.owner = nextAdmin.userId?._id || nextAdmin.userId;
  }
  if (await getLatestKeyVersion(group._id)) group.keyRotationPending = true;
  await group.save();

  await Promise.all([
    LocationShare.updateMany(
      { groupId: group._id, sharerId: meId, status: "active" },
      { $set: { status: "stopped", endedAt: new Date() } },
    ),
    GroupArchive.deleteMany({ ownerId: meId, groupId: group._id }),
    GroupKey.deleteMany({ groupId: group._id, userId: meId }),
  ]);

  leaveGroupRoom(meId, group._id);
  broadcastGroupRemoved(meId, {
    groupId: String(group._id),
    reason: "left",
  });

  const full = await loadGroup(group._id);
  await emitGroupToMembers(full, GROUP_SOCKET_EVENTS.GROUP_UPDATED);

  await requestKeyRotation(group, "member_left");

  return { destroyed: false };
};
