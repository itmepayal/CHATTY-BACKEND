import Group from "../models/group.model.js";
import GroupMessage from "../models/group-message.model.js";
import GroupKey from "../models/group-key.model.js";
import GroupArchive, {
  getArchivedGroupSet,
} from "../models/group-archive.model.js";
import LocationShare from "../models/location-share.model.js";
import { deleteFileToCloudinary } from "../config/cloudinary.config.js";
import { io, groupRoom } from "../lib/socket.js";
import { getBlockedByMe, getBlockersOf } from "../utils/group-guard.js";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import {
  parseBool,
  assertValidCipher,
  MAX_CIPHERTEXT_LENGTH,
} from "../utils/e2ee.js";
import { MAX_GROUP_TEXT } from "../constants/constants.js";

export const sid = (x) => String(x?._id ?? x);

export const getLatestKeyVersion = async (groupId) => {
  const k = await GroupKey.findOne({ groupId })
    .sort({ version: -1 })
    .select("version")
    .lean();
  return k?.version || 0;
};

export const getLatestVersions = async (groupIds) => {
  if (!groupIds.length) return new Map();
  const rows = await GroupKey.aggregate([
    { $match: { groupId: { $in: groupIds } } },
    { $group: { _id: "$groupId", version: { $max: "$version" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.version]));
};

export const storeGroupKeys = async (groupId, entries, wrappedBy) => {
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

export const requestKeyRotation = async (group, reason) => {
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

export const notifyKeysNeeded = async (group, newIds) => {
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

export const loadGroup = (id) =>
  Group.findById(id).populate("members.userId", "fullName avatar");

export const formatGroup = (group, extra = {}) => ({
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

export const presentGroup = async (group, extra = {}) => {
  const keyVersion = await getLatestKeyVersion(group._id);
  return formatGroup(group, { e2ee: keyVersion > 0, keyVersion, ...extra });
};

export const formatGroupMessage = (msg) => {
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

export const joinRoom = (userId, groupId) =>
  io.in(String(userId)).socketsJoin(groupRoom(groupId));

export const leaveRoom = (userId, groupId) =>
  io.in(String(userId)).socketsLeave(groupRoom(groupId));

export const emitToMembers = (group, event, payload, exceptIds = []) => {
  const skip = new Set(exceptIds.map(String));
  for (const m of group.members) {
    const uid = sid(m.userId);
    if (!skip.has(uid)) io.to(uid).emit(event, payload);
  }
};

export const emitToViewers = async (group, sharerId, event, payload) => {
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

export const getUnread = (groupId, userId, joinedAt, blockedIds) =>
  GroupMessage.countDocuments({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: [...blockedIds, userId] },
    readBy: { $ne: userId },
    silentReadBy: { $ne: userId },
  });

export const getLast = (groupId, joinedAt, blockedIds) =>
  GroupMessage.findOne({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: blockedIds },
  })
    .sort({ createdAt: -1 })
    .populate("senderId", "fullName avatar");

export const emitMemberConversation = async (groupId, member) => {
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

export const emitGroupConversation = async (group) => {
  try {
    await Promise.all(
      group.members.map((m) => emitMemberConversation(group._id, m)),
    );
  } catch (err) {
    console.error("emitGroupConversation failed:", err?.message || err);
  }
};

export const broadcastGroupMessage = async (group, message, senderId) => {
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

export const endShare = async (group, share, status = "stopped") => {
  const result = await LocationShare.updateOne(
    { _id: share._id, status: "active" },
    { status, endedAt: new Date() },
  );
  lastUpdateAt.delete(String(share._id));
  if (!result.modifiedCount) return false;

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

export const stopUserShares = async (group, userId) => {
  const active = await LocationShare.find({
    groupId: group._id,
    sharerId: userId,
    status: "active",
  });
  for (const s of active) {
    await endShare(group, s, "stopped");
  }
};

export const lastUpdateAt = new Map();

export const deleteMedia = (m) => [
  m.image?.public_id && deleteFileToCloudinary(m.image.public_id, "image"),
  m.file?.public_id &&
    deleteFileToCloudinary(m.file.public_id, m.file.resourceType || "raw"),
  m.audio?.public_id &&
    deleteFileToCloudinary(m.audio.public_id, m.audio.resourceType || "video"),
  m.video?.public_id &&
    deleteFileToCloudinary(m.video.public_id, m.video.resourceType || "video"),
];

export const findGroupMessageDuplicate = (groupId, senderId, clientId) =>
  GroupMessage.findOne({ groupId, senderId, clientId }).populate(
    "senderId",
    "fullName avatar",
  );

export const destroyGroup = async (group) => {
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

export const getMyGroupsList = async (me) => {
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

  result.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

  return result;
};

export const getGroupMessagesList = async (group, member, me, query) => {
  const blocked = await getBlockedByMe(me);

  const limit = Math.min(Number(query.limit) || 100, 200);
  const createdAt = { $gte: member.joinedAt };
  if (query.before) {
    const d = new Date(query.before);
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

  return msgs.reverse().map(formatGroupMessage);
};

export const markGroupMessagesSeen = async (
  group,
  member,
  me,
  privacyReadReceipts,
) => {
  const blocked = await getBlockedByMe(me);

  const unread = await GroupMessage.find({
    groupId: group._id,
    createdAt: { $gte: member.joinedAt },
    senderId: { $nin: [...blocked, me] },
    readBy: { $ne: me },
    silentReadBy: { $ne: me },
  }).select("_id");

  const ids = unread.map((m) => m._id);

  if (ids.length) {
    if (privacyReadReceipts) {
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

  return { count: ids.length };
};

export const validateGroupMessageInput = async (group, me, body, file) => {
  const text = body.text?.trim();
  const isVoice = body.isVoice === "true" || body.isVoice === true;
  const isVideo = body.isVideo === "true" || body.isVideo === true;
  const wantsE2EE = parseBool(body.encrypted ?? body.e2ee);

  if (!text && !file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
  }
  if (
    text &&
    text.length > (wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_GROUP_TEXT)
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Message can be at most ${MAX_GROUP_TEXT} characters.`,
    );
  }
  if (isVoice && file && !file.mimetype?.startsWith("audio/")) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Voice message must be an audio file.",
    );
  }
  if (isVideo && file && !file.mimetype?.startsWith("video/")) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Video message must be a video file.",
    );
  }

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
    assertValidCipher(text, body.iv);

    const keyVersion = Number(body.keyVersion);
    if (
      !Number.isInteger(keyVersion) ||
      keyVersion < 1 ||
      keyVersion > latestVersion
    ) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid key version.");
    }

    if (group.keyRotationPending && keyVersion === latestVersion) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "Group key is being rotated. Please try again in a moment.",
      );
    }

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

    cipher = { e2ee: true, iv: body.iv, keyVersion };
  }

  return { text, cipher, wantsE2EE, isVoice, isVideo };
};
