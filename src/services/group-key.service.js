import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import User from "../models/users.model.js";
import GroupKey from "../models/group-key.model.js";
import Group from "../models/group.model.js";
import { io } from "../lib/socket.js";
import { assertAdmin } from "../utils/group-guard.js";
import {
  getLatestKeyVersion,
  storeGroupKeys,
  sid,
  loadGroup,
  presentGroup,
  emitToMembers,
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
  const memberIds = new Set(group.members.map((m) => sid(m.userId)));
  if (entries.some((e) => !memberIds.has(e.userId))) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Keys can only be created for group members.",
    );
  }

  const latest = await getLatestKeyVersion(group._id);
  const maxIncoming = Math.max(...entries.map((e) => e.version));
  const isNewVersion = maxIncoming > latest;

  if (isNewVersion) {
    assertAdmin(member);

    if (maxIncoming !== latest + 1) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid key version.");
    }
    const covered = new Set(
      entries.filter((e) => e.version === maxIncoming).map((e) => e.userId),
    );
    if ([...memberIds].some((id) => !covered.has(id))) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "A new key version must include every member.",
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
        "Key was rotated by someone else. Fetch the new key.",
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
  const affected = [...new Set(entries.map((e) => e.userId))];
  affected.forEach((uid) =>
    io.to(uid).emit("group:keysUpdated", {
      groupId: String(group._id),
      latestVersion,
    }),
  );

  if (isNewVersion) {
    const full = await loadGroup(group._id);
    emitToMembers(full, "group:updated", await presentGroup(full));
  }

  return { latestVersion, stored: entries.length, isNewVersion, latest };
};
