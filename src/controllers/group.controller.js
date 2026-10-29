import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import Group from "../models/group.model.js";
import GroupMessage from "../models/groupmessage.model.js";
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
  ...extra,
});

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
    text: msg.text || "",
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
  await Group.deleteOne({ _id: group._id });
};

const groupController = {
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
    });

    [String(me), ...memberIds].forEach((id) => joinRoom(id, created._id));

    const group = await loadGroup(created._id);
    const payload = formatGroup(group);
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

    const result = await Promise.all(
      groups.map(async (g) => {
        const mine = g.members.find((m) => sid(m.userId) === String(me));
        const [unreadCount, last] = await Promise.all([
          getUnread(g._id, me, mine.joinedAt, blocked),
          getLast(g._id, mine.joinedAt, blocked),
        ]);
        return formatGroup(g, {
          unreadCount,
          lastMessage: last ? formatGroupMessage(last) : null,
          lastMessageAt: last?.createdAt || g.lastMessageAt || g.createdAt,
          archived: archivedSet.has(String(g._id)),
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
      formatGroup(group, { archived }),
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
    const payload = formatGroup(full);
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
    const payload = formatGroup(full);
    emitToMembers(full, "group:created", payload, [...existing]);
    emitToMembers(full, "group:updated", payload, newIds);

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
    await group.save();
    await GroupArchive.deleteOne({ ownerId: targetId, groupId: group._id });

    leaveRoom(targetId, group._id);
    io.to(targetId).emit("group:removed", {
      groupId: String(group._id),
      reason: "removed",
    });

    const full = await loadGroup(group._id);
    const payload = formatGroup(full);
    emitToMembers(full, "group:updated", payload);

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
    const payload = formatGroup(full);
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
    await group.save();
    await GroupArchive.deleteOne({ ownerId: me, groupId: group._id });

    leaveRoom(me, group._id);
    io.to(me).emit("group:removed", {
      groupId: String(group._id),
      reason: "left",
    });

    const full = await loadGroup(group._id);
    emitToMembers(full, "group:updated", formatGroup(full));

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

  sendGroupMessage: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const text = req.body.text?.trim();
    const clientId = readClientId(req.body);
    const isVoice = req.body.isVoice === "true" || req.body.isVoice === true;
    const isVideo = req.body.isVideo === "true" || req.body.isVideo === true;

    if (!text && !req.file) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
    }
    if (text && text.length > MAX_TEXT) {
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
