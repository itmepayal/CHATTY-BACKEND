import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import User from "../models/users.model.js";
import Group from "../models/group.model.js";
import GroupMessage from "../models/groupmessage.model.js";
import GroupKey from "../models/groupKey.model.js";
import GroupArchive, {
  getArchivedGroupSet,
} from "../models/grouparchive.model.js";
import LocationShare from "../models/LocationShare.model.js";
import {
  uploadFileToCloudinary,
  deleteFileToCloudinary,
} from "../config/cloudinary.config.js";
import { io, groupRoom, getPrivacy } from "../lib/socket.js";
import {
  getGroupAndMember,
  assertAdmin,
  getBlockedByMe,
  getBlockersOf,
  assertUsersAddable,
} from "../utils/groupguard.js";
/* ---------------- E2EE ---------------- */
import {
  MAX_CIPHERTEXT_LENGTH,
  parseBool,
  assertValidCipher,
  parseKeyEntries,
} from "../utils/e2ee.js";

const MAX_MEMBERS = 256;
const MAX_TEXT = 2000;
const MAX_VOICE_SECONDS = 300;
const MAX_VIDEO_SECONDS = 60;

const LIVE_DURATIONS_MIN = [15, 60, 480];
const MIN_UPDATE_INTERVAL_MS = 2000;

const lastUpdateAt = new Map();

const toNum = (v) =>
  v === null || v === undefined || v === "" ? NaN : Number(v);

const optNum = (v) => {
  const n = toNum(v);
  return Number.isFinite(n) ? n : undefined;
};

const validCoords = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

const readLocation = (body) => ({
  lat: toNum(body.lat),
  lng: toNum(body.lng),
  accuracy: optNum(body.accuracy),
  heading: optNum(body.heading),
  speed: optNum(body.speed),
});

const sid = (x) => String(x?._id ?? x);

const readClientId = (body) =>
  typeof body.clientId === "string" && body.clientId.length <= 64
    ? body.clientId
    : undefined;

const parseIds = (raw) => {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = raw.split(",");
    }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const ids = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID in list.");
  }
  return ids;
};

const validName = (name) => {
  if (!name || name.length < 2 || name.length > 50) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Group name must be 2-50 characters.",
    );
  }
};

const uploadImage = async (file) => {
  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload image.");
  }
  return { public_id: up.public_id, url: up.secure_url };
};

const uploadAttachment = async (
  file,
  { isVoice = false, isVideo = false, duration } = {},
) => {
  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload attachment.");
  }

  if (file.mimetype?.startsWith("image/")) {
    return { image: { public_id: up.public_id, url: up.secure_url } };
  }

  if (isVoice && file.mimetype?.startsWith("audio/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      audio: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VOICE_SECONDS),
        mimeType: file.mimetype.split(";")[0],
        resourceType: up.resource_type,
      },
    };
  }

  if (isVideo && file.mimetype?.startsWith("video/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      video: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VIDEO_SECONDS),
        mimeType: file.mimetype.split(";")[0],
        resourceType: up.resource_type,
      },
    };
  }

  return {
    file: {
      public_id: up.public_id,
      url: up.secure_url,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      resourceType: up.resource_type,
    },
  };
};

const deleteMedia = (m) => [
  m.image?.public_id && deleteFileToCloudinary(m.image.public_id, "image"),
  m.file?.public_id &&
    deleteFileToCloudinary(m.file.public_id, m.file.resourceType || "raw"),
  m.audio?.public_id &&
    deleteFileToCloudinary(m.audio.public_id, m.audio.resourceType || "video"),
  m.video?.public_id &&
    deleteFileToCloudinary(m.video.public_id, m.video.resourceType || "video"),
];

/* ---------------- E2EE: GROUP KEY HELPERS ---------------- */

// group ka sabse naya key version (0 = group E2EE nahi hai)
const getLatestKeyVersion = async (groupId) => {
  const k = await GroupKey.findOne({ groupId })
    .sort({ version: -1 })
    .select("version")
    .lean();
  return k?.version || 0;
};

// bahut saare groups ke liye ek hi query (getMyGroups)
const getLatestVersions = async (groupIds) => {
  if (!groupIds.length) return new Map();
  const rows = await GroupKey.aggregate([
    { $match: { groupId: { $in: groupIds } } },
    { $group: { _id: "$groupId", version: { $max: "$version" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.version]));
};

// wrapped keys store karo. Existing key kabhi overwrite nahi hoti ($setOnInsert).
const storeGroupKeys = async (groupId, entries, wrappedBy) => {
  if (!entries.length) return;
  await GroupKey.bulkWrite(
    entries.map((e) => ({
      updateOne: {
        filter: { groupId, userId: e.userId, version: e.version },
        update: {
          $setOnInsert: {
            groupId,
            userId: e.userId,
            version: e.version,
            wrappedKey: e.wrappedKey,
            iv: e.iv,
            wrappedBy,
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
};

// member hata / nikal gaya -> admins ko batao ki key rotate karni hai
// (server key bana nahi sakta, client rotate karega via POST /:id/keys)
const requestKeyRotation = async (group, reason) => {
  if (!(await getLatestKeyVersion(group._id))) return;
  group.members
    .filter((m) => m.role === "admin")
    .forEach((m) =>
      io.to(sid(m.userId)).emit("group:keyRotationRequired", {
        groupId: String(group._id),
        reason,
      }),
    );
};

// naye members aaye -> existing members (jinke paas key hai) unke liye key wrap karein
const notifyKeysNeeded = async (group, newIds) => {
  if (!(await getLatestKeyVersion(group._id))) return;
  const skip = new Set(newIds.map(String));
  group.members
    .filter((m) => !skip.has(sid(m.userId)))
    .forEach((m) =>
      io.to(sid(m.userId)).emit("group:keysNeeded", {
        groupId: String(group._id),
        userIds: newIds.map(String),
      }),
    );
};

const loadGroup = (id) =>
  Group.findById(id).populate("members.userId", "fullName avatar");

const formatGroup = (group, extra = {}) => ({
  id: group._id,
  name: group.name,
  avatar: group.avatar?.url || "",
  owner: sid(group.owner),
  members: group.members.map((m) => ({
    id: sid(m.userId),
    fullName: m.userId?.fullName || "",
    avatar: m.userId?.avatar?.url || "",
    role: m.role,
    joinedAt: m.joinedAt,
  })),
  createdAt: group.createdAt,
  lastMessageAt: group.lastMessageAt || group.createdAt,
  unreadCount: 0,
  lastMessage: null,
  archived: false,
  e2ee: false,
  keyVersion: 0,
  keyRotationPending: !!group.keyRotationPending,
  ...extra,
});

// formatGroup + e2ee info (ek group ke liye)
const presentGroup = async (group, extra = {}) => {
  const keyVersion = await getLatestKeyVersion(group._id);
  return formatGroup(group, { e2ee: keyVersion > 0, keyVersion, ...extra });
};

const formatGroupMessage = (msg) => {
  const sender = msg.senderId?._id ? msg.senderId : null;
  const hasLocation =
    Number.isFinite(msg.location?.lat) && Number.isFinite(msg.location?.lng);

  return {
    id: msg._id,
    groupId: sid(msg.groupId),
    senderId: sid(msg.senderId),
    sender: sender
      ? {
          id: sid(sender),
          fullName: sender.fullName,
          avatar: sender.avatar?.url || "",
        }
      : null,
    // e2ee true ho to `text` ciphertext (base64) hai, client decrypt karega
    text: msg.text || "",
    // expose both `e2ee` (group-store key derivation) and `encrypted` (needsDecrypt() check)
    e2ee: !!msg.e2ee,
    encrypted: !!msg.e2ee,
    iv: msg.e2ee ? msg.iv || null : null,
    keyVersion: msg.e2ee ? (msg.keyVersion ?? null) : null,
    image: msg.image?.url
      ? { url: msg.image.url, public_id: msg.image.public_id }
      : null,
    file: msg.file?.url
      ? {
          url: msg.file.url,
          name: msg.file.name,
          size: msg.file.size,
          mimeType: msg.file.mimeType,
        }
      : null,
    audio: msg.audio?.url
      ? {
          url: msg.audio.url,
          duration: msg.audio.duration || 0,
          mimeType: msg.audio.mimeType,
        }
      : null,
    video: msg.video?.url
      ? {
          url: msg.video.url,
          duration: msg.video.duration || 0,
          mimeType: msg.video.mimeType,
        }
      : null,
    location: hasLocation
      ? {
          lat: msg.location.lat,
          lng: msg.location.lng,
          accuracy: msg.location.accuracy,
          isLive: !!msg.location.isLive,
          shareId: msg.location.shareId ? String(msg.location.shareId) : null,
        }
      : null,
    clientId: msg.clientId,
    readBy: (msg.readBy || []).map(String),
    createdAt: msg.createdAt,
  };
};

const emitToMembers = (group, event, payload, exceptIds = []) => {
  const skip = new Set(exceptIds.map(String));
  for (const m of group.members) {
    const uid = sid(m.userId);
    if (!skip.has(uid)) io.to(uid).emit(event, payload);
  }
};

const emitToViewers = async (group, sharerId, event, payload) => {
  const memberIds = group.members.map((m) => sid(m.userId));
  const [blockers, blockedBySharer] = await Promise.all([
    getBlockersOf(memberIds, sharerId),
    getBlockedByMe(sharerId),
  ]);
  const blockedSet = new Set([...blockedBySharer].map(String));
  memberIds
    .filter((id) => !blockers.has(id) && !blockedSet.has(id))
    .forEach((id) => io.to(id).emit(event, payload));
};

const joinRoom = (userId, groupId) =>
  io.in(String(userId)).socketsJoin(groupRoom(groupId));
const leaveRoom = (userId, groupId) =>
  io.in(String(userId)).socketsLeave(groupRoom(groupId));

const getUnread = (groupId, userId, joinedAt, blockedIds) =>
  GroupMessage.countDocuments({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: [...blockedIds, userId] },
    readBy: { $ne: userId },
    silentReadBy: { $ne: userId },
  });

const getLast = (groupId, joinedAt, blockedIds) =>
  GroupMessage.findOne({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: blockedIds },
  })
    .sort({ createdAt: -1 })
    .populate("senderId", "fullName avatar");

const emitMemberConversation = async (groupId, member) => {
  const uid = sid(member.userId);
  const blocked = await getBlockedByMe(uid);
  const [unreadCount, last] = await Promise.all([
    getUnread(groupId, uid, member.joinedAt, blocked),
    getLast(groupId, member.joinedAt, blocked),
  ]);
  io.to(uid).emit("group:conversationUpdated", {
    groupId: String(groupId),
    unreadCount,
    lastMessage: last ? formatGroupMessage(last) : null,
    lastMessageAt: last?.createdAt ?? null,
    ts: Date.now(),
  });
};

const emitGroupConversation = async (group) => {
  try {
    await Promise.all(
      group.members.map((m) => emitMemberConversation(group._id, m)),
    );
  } catch (err) {
    console.error("emitGroupConversation failed:", err?.message || err);
  }
};

const broadcastGroupMessage = async (group, message, senderId) => {
  await message.populate("senderId", "fullName avatar");
  await Group.updateOne(
    { _id: group._id },
    { lastMessageAt: message.createdAt },
  );

  const payload = formatGroupMessage(message);

  const memberIds = group.members.map((m) => sid(m.userId));
  const blockers = await getBlockersOf(memberIds, senderId);
  memberIds
    .filter((id) => !blockers.has(id))
    .forEach((id) => io.to(id).emit("group:newMessage", payload));

  emitGroupConversation(group);

  return payload;
};

const endShare = async (group, share, status = "stopped") => {
  const res = await LocationShare.updateOne(
    { _id: share._id, status: "active" },
    { status, endedAt: new Date() },
  );
  lastUpdateAt.delete(String(share._id));
  if (!res.modifiedCount) return false;

  if (share.messageId) {
    await GroupMessage.updateOne(
      { _id: share.messageId },
      { "location.isLive": false },
    );
  }

  emitToMembers(group, "group:location:ended", {
    groupId: String(group._id),
    shareId: String(share._id),
  });
  return true;
};

const stopUserShares = async (group, userId) => {
  const active = await LocationShare.find({
    groupId: group._id,
    sharerId: userId,
    status: "active",
  });
  for (const s of active) {
    await endShare(group, s, "stopped");
  }
};

const destroyGroup = async (group) => {
  const media = await GroupMessage.find({
    groupId: group._id,
    $or: [
      { "image.public_id": { $exists: true, $ne: null } },
      { "file.public_id": { $exists: true, $ne: null } },
      { "audio.public_id": { $exists: true, $ne: null } },
      { "video.public_id": { $exists: true, $ne: null } },
    ],
  })
    .select("image file audio video")
    .lean();

  await Promise.allSettled([
    ...media.flatMap(deleteMedia),
    group.avatar?.public_id && deleteFileToCloudinary(group.avatar.public_id),
  ]);
  await GroupMessage.deleteMany({ groupId: group._id });
  await GroupArchive.deleteMany({ groupId: group._id });
  await LocationShare.deleteMany({ groupId: group._id });
  await GroupKey.deleteMany({ groupId: group._id });
  await Group.deleteOne({ _id: group._id });
};

const groupController = {
  /* ---------------- CREATE ---------------- */
  // E2EE group: body.e2ee = true + body.keys = [{ userId, wrappedKey, iv }, ...]
  // (version 1; creator + har member ke liye ek wrapped key)
  createGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const name = req.body.name?.trim();
    validName(name);

    const memberIds = parseIds(req.body.memberIds).filter(
      (id) => id !== String(me),
    );
    if (!memberIds.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Add at least one member.");
    }
    if (memberIds.length + 1 > MAX_MEMBERS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `A group can have at most ${MAX_MEMBERS} members.`,
      );
    }
    await assertUsersAddable(me, memberIds);

    /* E2EE keys validate (group banne se PEHLE) */
    const wantsE2EE = parseBool(req.body.e2ee);
    let keyEntries = [];
    if (wantsE2EE) {
      keyEntries = parseKeyEntries(req.body.keys, 1);
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
    }

    const avatar = req.file?.path ? await uploadImage(req.file) : undefined;

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
    const payload = await presentGroup(group);
    emitToMembers(group, "group:created", payload);

    return new ApiResponse(StatusCodes.CREATED, payload, "Group created.").send(
      res,
    );
  }),

  getMyGroups: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const [groups, blocked, archivedSet] = await Promise.all([
      Group.find({ "members.userId": me }).populate(
        "members.userId",
        "fullName avatar",
      ),
      getBlockedByMe(me),
      getArchivedGroupSet(me),
    ]);

    const versions = await getLatestVersions(groups.map((g) => g._id));

    const result = await Promise.all(
      groups.map(async (g) => {
        const mine = g.members.find((m) => sid(m.userId) === String(me));
        const [unreadCount, last] = await Promise.all([
          getUnread(g._id, me, mine.joinedAt, blocked),
          getLast(g._id, mine.joinedAt, blocked),
        ]);
        const keyVersion = versions.get(String(g._id)) || 0;
        return formatGroup(g, {
          unreadCount,
          lastMessage: last ? formatGroupMessage(last) : null,
          lastMessageAt: last?.createdAt || g.lastMessageAt || g.createdAt,
          archived: archivedSet.has(String(g._id)),
          e2ee: keyVersion > 0,
          keyVersion,
        });
      }),
    );

    result.sort(
      (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt),
    );

    return new ApiResponse(StatusCodes.OK, result, "Groups fetched.").send(res);
  }),

  getGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    await getGroupAndMember(req.params.id, me);
    const group = await loadGroup(req.params.id);
    const archived = !!(await GroupArchive.exists({
      ownerId: me,
      groupId: group._id,
    }));
    return new ApiResponse(
      StatusCodes.OK,
      await presentGroup(group, { archived }),
      "Group fetched.",
    ).send(res);
  }),

  archiveGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    await GroupArchive.updateOne(
      { ownerId: me, groupId: group._id },
      { $setOnInsert: { ownerId: me, groupId: group._id } },
      { upsert: true },
    );

    const payload = { groupId: String(group._id), archived: true };
    io.to(String(me)).emit("group:archiveChanged", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Group archived.").send(
      res,
    );
  }),

  unarchiveGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    await GroupArchive.deleteOne({ ownerId: me, groupId: group._id });

    const payload = { groupId: String(group._id), archived: false };
    io.to(String(me)).emit("group:archiveChanged", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Group unarchived.").send(
      res,
    );
  }),

  updateGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    let changed = false;
    let oldPublicId;

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      validName(name);
      if (name !== group.name) {
        group.name = name;
        changed = true;
      }
    }

    if (req.file?.path) {
      oldPublicId = group.avatar?.public_id;
      group.avatar = await uploadImage(req.file);
      changed = true;
    }

    if (!changed) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No changes to update.");
    }

    await group.save();
    if (oldPublicId) await deleteFileToCloudinary(oldPublicId).catch(() => {});

    const full = await loadGroup(group._id);
    const payload = await presentGroup(full);
    emitToMembers(full, "group:updated", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Group updated.").send(res);
  }),

  addMembers: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    const existing = new Set(group.members.map((m) => sid(m.userId)));
    const newIds = parseIds(req.body.memberIds).filter(
      (id) => !existing.has(id),
    );

    if (!newIds.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No new members to add.");
    }
    if (group.members.length + newIds.length > MAX_MEMBERS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `A group can have at most ${MAX_MEMBERS} members.`,
      );
    }
    await assertUsersAddable(me, newIds);

    const joinedAt = new Date();
    group.members.push(
      ...newIds.map((userId) => ({ userId, role: "member", joinedAt })),
    );
    await group.save();

    newIds.forEach((id) => joinRoom(id, group._id));

    const full = await loadGroup(group._id);
    const payload = await presentGroup(full);
    emitToMembers(full, "group:created", payload, [...existing]);
    emitToMembers(full, "group:updated", payload, newIds);

    // E2EE group: existing members ko bolo naye members ke liye key wrap karein
    await notifyKeysNeeded(full, newIds);

    return new ApiResponse(StatusCodes.OK, payload, "Members added.").send(res);
  }),

  removeMember: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

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
    // E2EE group: hata hua member purani key jaanta hai -> rotation hone tak naye messages block
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
    const payload = await presentGroup(full);
    emitToMembers(full, "group:updated", payload);

    // hata hua member purani key jaanta hai -> admin key rotate kare
    await requestKeyRotation(group, "member_removed");

    return new ApiResponse(StatusCodes.OK, payload, "Member removed.").send(
      res,
    );
  }),

  changeRole: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { role } = req.body;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

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
    const payload = await presentGroup(full);
    emitToMembers(full, "group:updated", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Role updated.").send(res);
  }),

  leaveGroup: asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const { group } = await getGroupAndMember(req.params.id, me);

    await stopUserShares(group, me);

    group.members = group.members.filter((m) => sid(m.userId) !== me);

    if (group.members.length === 0) {
      await destroyGroup(group);
      leaveRoom(me, group._id);
      io.to(me).emit("group:removed", {
        groupId: String(group._id),
        reason: "left",
      });
      return new ApiResponse(
        StatusCodes.OK,
        null,
        "You left. The group was deleted.",
      ).send(res);
    }

    const byJoin = [...group.members].sort((a, b) => a.joinedAt - b.joinedAt);
    if (!group.members.some((m) => m.role === "admin"))
      byJoin[0].role = "admin";
    if (sid(group.owner) === me) {
      group.owner = byJoin.find((m) => m.role === "admin").userId;
    }
    // E2EE group: jaane wala member purani key jaanta hai -> rotation hone tak naye messages block
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
    emitToMembers(full, "group:updated", await presentGroup(full));

    // jaane wala member purani key jaanta hai -> admin key rotate kare
    await requestKeyRotation(group, "member_left");

    return new ApiResponse(StatusCodes.OK, null, "You left the group.").send(
      res,
    );
  }),

  deleteGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    if (sid(group.owner) !== String(me)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Only the group owner can delete the group.",
      );
    }

    const payload = { groupId: String(group._id) };
    emitToMembers(group, "group:deleted", payload);
    io.in(groupRoom(group._id)).socketsLeave(groupRoom(group._id));

    await destroyGroup(group);

    return new ApiResponse(StatusCodes.OK, payload, "Group deleted.").send(res);
  }),

  /* ---------------- E2EE: GROUP KEYS ---------------- */

  // GET /groups/:id/keys
  // Mere saare wrapped keys (har version) + wrapper ki public key
  // (client: ECDH(myPrivate, wrapperPublic) se unwrap karega)
  getMyGroupKeys: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

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

    return new ApiResponse(
      StatusCodes.OK,
      {
        latestVersion,
        keys: keys.map((k) => ({
          version: k.version,
          wrappedKey: k.wrappedKey,
          iv: k.iv,
          wrappedBy: String(k.wrappedBy),
          wrapperPublicKey: pubMap.get(String(k.wrappedBy)) || null,
          createdAt: k.createdAt,
        })),
      },
      "Group keys fetched.",
    ).send(res);
  }),

  // GET /groups/:id/keys/pending
  // Kin members ke paas koi key version missing hai (+ unki public key),
  // taaki key-holder client unke liye wrap karke POST /:id/keys kar sake.
  getPendingKeyMembers: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const latestVersion = await getLatestKeyVersion(group._id);
    if (!latestVersion) {
      return new ApiResponse(
        StatusCodes.OK,
        { latestVersion: 0, pending: [] },
        "Group is not encrypted.",
      ).send(res);
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
      if (missingVersions.length)
        pending.push({ userId: uid, missingVersions });
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

    return new ApiResponse(
      StatusCodes.OK,
      { latestVersion, pending },
      "Pending key members fetched.",
    ).send(res);
  }),

  // POST /groups/:id/keys
  // body: { keys: [{ userId, version, wrappedKey, iv }, ...] }
  //  - version <= latest  : koi bhi member, sirf missing keys add hongi (naye members ke liye)
  //  - version == latest+1: sirf admin (enable E2EE / key rotation), har current member ke liye key zaroori
  setGroupKeys: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);

    const entries = parseKeyEntries(req.body.keys, toNum(req.body.version));

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

      // purane groups (jinke Group.keyVersion field nahi / kam hai) ko sync karo
      await Group.updateOne(
        { _id: group._id, keyVersion: { $lt: latest } },
        { keyVersion: latest },
      );

      // version atomically claim karo: do admins ek saath rotate karein to sirf ek jeetega
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
        // claim wapas lo, warna group aage ke liye atak jayega
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

    // E2EE abhi enable / rotate hua ho to sabko naya group state bhejo
    if (isNewVersion) {
      const full = await loadGroup(group._id);
      emitToMembers(full, "group:updated", await presentGroup(full));
    }

    return new ApiResponse(
      StatusCodes.OK,
      { latestVersion, stored: entries.length },
      isNewVersion && latest === 0
        ? "Encryption enabled for this group."
        : "Group keys saved.",
    ).send(res);
  }),

  /* ---------------- MESSAGES ---------------- */
  getGroupMessages: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const blocked = await getBlockedByMe(me);

    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const createdAt = { $gte: member.joinedAt };
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (!Number.isNaN(d.getTime())) createdAt.$lt = d;
    }

    const msgs = await GroupMessage.find({
      groupId: group._id,
      createdAt,
      senderId: { $nin: blocked },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("senderId", "fullName avatar");

    return new ApiResponse(
      StatusCodes.OK,
      msgs.reverse().map(formatGroupMessage),
      "Group messages fetched.",
    ).send(res);
  }),

  // E2EE group me text hamesha encrypted hona chahiye:
  //   body = { text: "<ciphertext b64>", iv: "<b64>", keyVersion: N, e2ee: true }
  sendGroupMessage: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const text = req.body.text?.trim();
    const clientId = readClientId(req.body);
    const isVoice = req.body.isVoice === "true" || req.body.isVoice === true;
    const isVideo = req.body.isVideo === "true" || req.body.isVideo === true;
    // Frontend sends `encrypted`, accept `e2ee` as legacy fallback
    const wantsE2EE = parseBool(req.body.encrypted ?? req.body.e2ee);

    if (!text && !req.file) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
    }
    if (text && text.length > (wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Message can be at most ${MAX_TEXT} characters.`,
      );
    }
    if (isVoice && req.file && !req.file.mimetype?.startsWith("audio/")) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Voice message must be an audio file.",
      );
    }
    if (isVideo && req.file && !req.file.mimetype?.startsWith("video/")) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Video message must be a video file.",
      );
    }

    /* ---- E2EE checks ---- */
    const latestVersion = await getLatestKeyVersion(group._id);
    let cipher = {};

    if (latestVersion > 0 && text && !wantsE2EE) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "This group is end-to-end encrypted. Send encrypted text only.",
      );
    }

    if (wantsE2EE) {
      if (!latestVersion) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          "Encryption is not enabled for this group.",
        );
      }
      if (!text) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Encrypted message needs ciphertext.",
        );
      }
      assertValidCipher(text, req.body.iv);

      const keyVersion = Number(req.body.keyVersion);
      if (
        !Number.isInteger(keyVersion) ||
        keyVersion < 1 ||
        keyVersion > latestVersion
      ) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid key version.");
      }

      // member hata/nikla hai: purani key se naye messages nahi, rotation ka wait karo
      if (group.keyRotationPending && keyVersion === latestVersion) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          "Group key is being rotated. Please try again in a moment.",
        );
      }

      // sender ke paas us version ki key honi chahiye
      const hasKey = await GroupKey.exists({
        groupId: group._id,
        userId: me,
        version: keyVersion,
      });
      if (!hasKey) {
        throw new ApiError(
          StatusCodes.FORBIDDEN,
          "You don't have the key for this version.",
        );
      }

      cipher = { e2ee: true, iv: req.body.iv, keyVersion };
    }

    const findDuplicate = () =>
      GroupMessage.findOne({
        groupId: group._id,
        senderId: me,
        clientId,
      }).populate("senderId", "fullName avatar");

    if (clientId) {
      const dup = await findDuplicate();
      if (dup) {
        return new ApiResponse(
          StatusCodes.OK,
          formatGroupMessage(dup),
          "Message already sent.",
        ).send(res);
      }
    }

    const attachment = req.file?.path
      ? await uploadAttachment(req.file, {
          isVoice,
          isVideo,
          duration: req.body.duration,
        })
      : {};

    let message;
    try {
      message = await GroupMessage.create({
        groupId: group._id,
        senderId: me,
        text,
        ...attachment,
        ...cipher,
        clientId,
        readBy: [me],
      });
    } catch (error) {
      await Promise.allSettled(deleteMedia(attachment));

      if (error?.code === 11000 && clientId) {
        const dup = await findDuplicate();
        if (dup) {
          return new ApiResponse(
            StatusCodes.OK,
            formatGroupMessage(dup),
            "Message already sent.",
          ).send(res);
        }
      }
      throw error;
    }

    const payload = await broadcastGroupMessage(group, message, me);

    return new ApiResponse(StatusCodes.CREATED, payload, "Message sent.").send(
      res,
    );
  }),

  markGroupSeen: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const blocked = await getBlockedByMe(me);
    const { readReceipts } = getPrivacy(me);

    const unread = await GroupMessage.find({
      groupId: group._id,
      createdAt: { $gte: member.joinedAt },
      senderId: { $nin: [...blocked, me] },
      readBy: { $ne: me },
      silentReadBy: { $ne: me },
    }).select("_id");

    const ids = unread.map((m) => m._id);

    if (ids.length) {
      if (readReceipts) {
        await GroupMessage.updateMany(
          { _id: { $in: ids } },
          { $addToSet: { readBy: me } },
        );
        io.to(groupRoom(group._id)).emit("group:messagesSeen", {
          groupId: String(group._id),
          seenBy: String(me),
          messageIds: ids,
        });
      } else {
        await GroupMessage.updateMany(
          { _id: { $in: ids } },
          { $addToSet: { silentReadBy: me } },
        );
      }
    }

    await emitMemberConversation(group._id, member);

    return new ApiResponse(
      StatusCodes.OK,
      { count: ids.length },
      "Messages marked as seen.",
    ).send(res);
  }),

  /* ---------------- LOCATION ---------------- */
  // NOTE: location lat/lng plaintext hi rehta hai (server live tracking handle karta hai).
  startGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const { mode } = req.body;
    const { lat, lng, accuracy, heading, speed } = readLocation(req.body);
    const durationMin = toNum(req.body.durationMin);
    const clientId = readClientId(req.body);

    if (mode !== "current" && mode !== "live") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share mode.");
    }
    if (!validCoords(lat, lng)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid location.");
    }
    if (mode === "live" && !LIVE_DURATIONS_MIN.includes(durationMin)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid duration.");
    }

    /* ---- duplicate (client retry) check: SABSE PEHLE, koi side-effect se pehle ---- */
    const findDuplicate = () =>
      GroupMessage.findOne({
        groupId: group._id,
        senderId: me,
        clientId,
      }).populate("senderId", "fullName avatar");

    const respondDuplicate = async (dup) => {
      const message = formatGroupMessage(dup);
      if (mode === "live" && dup.location?.shareId) {
        const share = await LocationShare.findById(dup.location.shareId);
        return new ApiResponse(
          StatusCodes.OK,
          { message, share },
          "Live location already started.",
        ).send(res);
      }
      return new ApiResponse(
        StatusCodes.OK,
        message,
        "Location already sent.",
      ).send(res);
    };

    if (clientId) {
      const dup = await findDuplicate();
      if (dup) return respondDuplicate(dup);
    }

    /* ---- one-time pin ---- */
    if (mode === "current") {
      let message;
      try {
        message = await GroupMessage.create({
          groupId: group._id,
          senderId: me,
          location: { lat, lng, accuracy, isLive: false },
          clientId,
          readBy: [me],
        });
      } catch (error) {
        if (error?.code === 11000 && clientId) {
          const dup = await findDuplicate();
          if (dup) return respondDuplicate(dup);
        }
        throw error;
      }

      const payload = await broadcastGroupMessage(group, message, me);

      return new ApiResponse(
        StatusCodes.CREATED,
        payload,
        "Location sent.",
      ).send(res);
    }

    await stopUserShares(group, me);

    const now = new Date();
    let share;
    try {
      share = await LocationShare.create({
        sharerId: me,
        groupId: group._id,
        expiresAt: new Date(now.getTime() + durationMin * 60_000),
        lastLocation: { lat, lng, accuracy, heading, speed, updatedAt: now },
      });
    } catch (error) {
      if (error?.code === 11000) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          "A live share is already active in this group.",
        );
      }
      throw error;
    }

    let message;
    try {
      message = await GroupMessage.create({
        groupId: group._id,
        senderId: me,
        location: {
          lat,
          lng,
          accuracy,
          isLive: true,
          shareId: share._id,
        },
        clientId,
        readBy: [me],
      });
    } catch (error) {
      await LocationShare.deleteOne({ _id: share._id });

      if (error?.code === 11000 && clientId) {
        const dup = await findDuplicate();
        if (dup) return respondDuplicate(dup);
      }
      throw error;
    }

    share.messageId = message._id;
    await LocationShare.updateOne(
      { _id: share._id },
      { messageId: message._id },
    );

    const payload = await broadcastGroupMessage(group, message, me);

    await emitToViewers(group, me, "group:location:update", {
      groupId: String(group._id),
      shareId: String(share._id),
      sharerId: String(me),
      lat,
      lng,
      accuracy,
      heading,
      speed,
      updatedAt: now,
    });

    return new ApiResponse(
      StatusCodes.CREATED,
      { message: payload, share },
      "Live location started.",
    ).send(res);
  }),

  updateGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { shareId } = req.params;
    const { group } = await getGroupAndMember(req.params.id, me);

    if (!mongoose.Types.ObjectId.isValid(shareId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share ID.");
    }

    const { lat, lng, accuracy, heading, speed } = readLocation(req.body);

    if (!validCoords(lat, lng)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid location.");
    }

    const key = String(shareId);
    const nowMs = Date.now();
    if (nowMs - (lastUpdateAt.get(key) || 0) < MIN_UPDATE_INTERVAL_MS) {
      return new ApiResponse(
        StatusCodes.OK,
        { shareId: key, skipped: true },
        "Update skipped (too frequent).",
      ).send(res);
    }
    if (lastUpdateAt.size > 5000) lastUpdateAt.clear();
    lastUpdateAt.set(key, nowMs);

    const now = new Date();

    const share = await LocationShare.findOneAndUpdate(
      {
        _id: shareId,
        groupId: group._id,
        sharerId: me,
        status: "active",
        expiresAt: { $gt: now },
      },
      {
        $set: {
          lastLocation: { lat, lng, accuracy, heading, speed, updatedAt: now },
        },
      },
      { new: true },
    );

    if (!share) {
      lastUpdateAt.delete(key);

      const stale = await LocationShare.findOne({
        _id: shareId,
        groupId: group._id,
        sharerId: me,
        status: "active",
        expiresAt: { $lte: now },
      });
      if (stale) {
        await endShare(group, stale, "expired");
        throw new ApiError(StatusCodes.GONE, "Live share has expired.");
      }
      throw new ApiError(StatusCodes.NOT_FOUND, "Live share not found.");
    }

    const payload = {
      groupId: String(group._id),
      shareId: String(share._id),
      sharerId: String(me),
      lat,
      lng,
      accuracy,
      heading,
      speed,
      updatedAt: now,
    };

    await emitToViewers(group, me, "group:location:update", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Location updated.").send(
      res,
    );
  }),

  stopGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { shareId } = req.params;
    const { group } = await getGroupAndMember(req.params.id, me);

    if (!mongoose.Types.ObjectId.isValid(shareId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share ID.");
    }

    const share = await LocationShare.findOne({
      _id: shareId,
      groupId: group._id,
      sharerId: me,
      status: "active",
    });
    if (!share) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Live share not found.");
    }

    await endShare(group, share, "stopped");

    return new ApiResponse(
      StatusCodes.OK,
      { shareId: share._id },
      "Live location stopped.",
    ).send(res);
  }),

  getActiveGroupShares: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    const now = new Date();

    const stale = await LocationShare.find({
      groupId: group._id,
      status: "active",
      expiresAt: { $lte: now },
    });
    for (const s of stale) {
      await endShare(group, s, "expired");
    }

    const blocked = await getBlockedByMe(me);

    const [mine, candidates] = await Promise.all([
      LocationShare.find({
        groupId: group._id,
        sharerId: me,
        status: "active",
        expiresAt: { $gt: now },
      }),
      LocationShare.find({
        groupId: group._id,
        sharerId: { $nin: [...blocked, me] },
        status: "active",
        expiresAt: { $gt: now },
      }),
    ]);

    const sharerIds = [...new Set(candidates.map((s) => String(s.sharerId)))];
    const blockedMe = sharerIds.length
      ? await getBlockersOf(sharerIds, me)
      : new Set();
    const inGroup = candidates.filter(
      (s) => !blockedMe.has(String(s.sharerId)),
    );

    return new ApiResponse(
      StatusCodes.OK,
      { mine, inGroup },
      "Active location shares.",
    ).send(res);
  }),
};

export default groupController;
