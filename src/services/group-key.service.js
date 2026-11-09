import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import User from "../models/users.model.js";
import GroupKey from "../models/group-key.model.js";
import Group from "../models/group.model.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";
import { GROUP_ERROR_MESSAGES } from "../constants/group.constants.js";
import { canSetGroupKeys } from "../policies/group.policy.js";
import { broadcastGroupKeysUpdated } from "../events/group.events.js";
import {
  getLatestKeyVersion,
  storeGroupKeys,
  sid,
  loadGroup,
  emitGroupToMembers,
} from "./group.service.js";

export const validateInitialKeyEntries = ({ keyEntries, me, memberIds }) => {
  const need = new Set([String(me), ...memberIds]);
  const got = new Set(
    keyEntries.filter((e) => e.version === 1).map((e) => e.userId),
  );
  const invalid =
    keyEntries.some((e) => e.version !== 1 || !need.has(e.userId)) ||
    [...need].some((id) => !got.has(id));
  if (invalid) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Provide a wrapped key (version 1) for every member.",
    );
  }
};

export const getMyKeysPayload = async (group, me) => {
  const keys = await GroupKey.find({ groupId: group._id, userId: me })
    .sort({ version: 1 })
    .lean();

  const wrapperIds = [...new Set(keys.map((k) => String(k.wrappedBy)))];
  const wrappers = wrapperIds.length
    ? await User.find({ _id: { $in: wrapperIds } })
        .select("+publicKey")
        .lean()
    : [];
  const pubMap = new Map(
    wrappers.map((u) => [String(u._id), u.publicKey || null]),
  );

  const latestVersion = await getLatestKeyVersion(group._id);

  return {
    latestVersion,
    keys: keys.map((k) => ({
      version: k.version,
      wrappedKey: k.wrappedKey,
      iv: k.iv,
      wrappedBy: String(k.wrappedBy),
      wrapperPublicKey: pubMap.get(String(k.wrappedBy)) || null,
      createdAt: k.createdAt,
    })),
  };
};

export const getPendingKeyMembersPayload = async (group) => {
  const latestVersion = await getLatestKeyVersion(group._id);
  if (!latestVersion) {
    return { notEncrypted: true, latestVersion: 0, pending: [] };
  }

  const rows = await GroupKey.find({ groupId: group._id })
    .select("userId version")
    .lean();

  const have = new Map();
  for (const r of rows) {
    const k = String(r.userId);
    if (!have.has(k)) have.set(k, new Set());
    have.get(k).add(r.version);
  }

  const pending = [];
  for (const m of group.members) {
    const uid = sid(m.userId);
    const missingVersions = [];
    for (let v = 1; v <= latestVersion; v++) {
      if (!have.get(uid)?.has(v)) missingVersions.push(v);
    }
    if (missingVersions.length) pending.push({ userId: uid, missingVersions });
  }

  if (pending.length) {
    const users = await User.find({
      _id: { $in: pending.map((p) => p.userId) },
    })
      .select("+publicKey")
      .lean();
    const pubMap = new Map(
      users.map((u) => [String(u._id), u.publicKey || null]),
    );
    pending.forEach((p) => {
      p.publicKey = pubMap.get(p.userId) || null;
    });
  }

  return { notEncrypted: false, latestVersion, pending };
};

export const applyGroupKeys = async ({ group, member, entries, me }) => {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Keys array cannot be empty.");
  }

  for (const e of entries) {
    const v = Number(e.version);
    if (!Number.isInteger(v) || Number.isNaN(v) || v < 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.INVALID_KEY_VERSION,
      );
    }
  }

  const memberIds = new Set(group.members.map((m) => sid(m.userId)));
  if (entries.some((e) => !memberIds.has(String(e.userId)))) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.KEYS_ONLY_FOR_MEMBERS,
    );
  }

  const latest = await getLatestKeyVersion(group._id);
  const maxIncoming = Math.max(...entries.map((e) => Number(e.version)));
  const isNewVersion = maxIncoming > latest;

  const hasCurrentKey =
    latest > 0
      ? await GroupKey.exists({
          groupId: group._id,
          userId: me,
          version: latest,
        })
      : true;

  canSetGroupKeys({
    group,
    actorId: me,
    member,
    isNewVersion,
    hasCurrentKey: Boolean(hasCurrentKey),
  });

  if (isNewVersion) {
    if (maxIncoming !== latest + 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.KEY_VERSION_MUST_BE_SEQUENTIAL,
      );
    }
    const covered = new Set(
      entries
        .filter((e) => Number(e.version) === maxIncoming)
        .map((e) => String(e.userId)),
    );
    if ([...memberIds].some((id) => !covered.has(id))) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.KEY_VERSION_INCLUDE_ALL,
      );
    }

    await Group.updateOne(
      { _id: group._id, keyVersion: { $lt: latest } },
      { keyVersion: latest },
    );

    const claimed = await Group.findOneAndUpdate(
      { _id: group._id, keyVersion: latest },
      { keyVersion: maxIncoming },
    );
    if (!claimed) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        GROUP_ERROR_MESSAGES.KEY_ROTATION_CONFLICT,
      );
    }
  }

  try {
    await storeGroupKeys(group._id, entries, me);
  } catch (error) {
    if (isNewVersion) {
      await GroupKey.deleteMany({ groupId: group._id, version: maxIncoming });
      await Group.updateOne(
        { _id: group._id, keyVersion: maxIncoming },
        { keyVersion: latest },
      );
    }
    throw error;
  }

  if (isNewVersion) {
    await Group.updateOne({ _id: group._id }, { keyRotationPending: false });
  }

  const latestVersion = Math.max(latest, maxIncoming);
  const affected = [...new Set(entries.map((e) => String(e.userId)))];
  broadcastGroupKeysUpdated(affected, {
    groupId: String(group._id),
    latestVersion,
  });

  if (isNewVersion) {
    const full = await loadGroup(group._id);
    await emitGroupToMembers(full, GROUP_SOCKET_EVENTS.GROUP_UPDATED);
  }

  return { latestVersion, stored: entries.length, isNewVersion, latest };
};
