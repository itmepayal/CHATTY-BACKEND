import fs from "fs/promises";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import * as groupRepository from "../repositories/group.repository.js";
import * as groupMessageRepository from "../repositories/group-message.repository.js";
import * as groupKeyRepository from "../repositories/group-key.repository.js";
import * as groupArchiveRepository from "../repositories/group-archive.repository.js";
import { getArchivedGroupSet } from "../repositories/group-archive.repository.js";
import * as locationShareRepository from "../../messaging/repositories/location-share.repository.js";
import * as contactRepository from "../../contacts/repositories/contact.repository.js";
import * as userRepository from "../../users/repositories/user.repository.js";
import * as groupCallRepository from "../../calling/repositories/group-call.repository.js";
import { io } from "../../../infrastructure/socket/socket.js";
import { terminateGroupCallByGroup } from "../../calling/signaling/groupCallSignaling.js";
import { deleteFileToCloudinary } from "../../../config/cloudinary.config.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";
import {
  MAX_GROUP_TEXT,
  MAX_CIPHERTEXT_LENGTH,
  GROUP_ERROR_MESSAGES,
} from "../constants/index.js";
import { parseBool, assertValidCipher } from "../../messaging/utils/e2ee.js";
import {
  canViewSync,
  canViewProfilePhoto,
} from "../../privacy/services/privacy-visibility.service.js";
import {
  getBlockedByMe,
  getBlockersOf,
  getGroupAndMember,
  assertAdmin,
} from "../helpers/group.member.helpers.js";
import { uploadImage } from "./group-media.service.js";
import {
  joinGroupRoom,
  leaveGroupRoom,
  emitToGroupMembers,
  emitToGroupRoom,
  emitToUser,
  broadcastGroupDeleted,
  broadcastGroupArchiveChanged,
  broadcastGroupKeyRotationRequired,
  broadcastGroupKeysNeeded,
  emitGroupConversationUpdate,
} from "../events/group.events.js";

export const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (_err) {}
};

export const sid = (x) => String(x?._id ?? x);

export const getLatestKeyVersion = async (groupId) => {
  const latest = await groupKeyRepository
    .findOne({ groupId })
    .sort({ version: -1 })
    .select("version")
    .lean();
  return latest?.version || 0;
};

export const getLatestVersions = async (groupIds) => {
  const rows = await groupKeyRepository.aggregate([
    { $match: { groupId: { $in: groupIds } } },
    { $group: { _id: "$groupId", maxVersion: { $max: "$version" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.maxVersion]));
};

export const storeGroupKeys = async (groupId, entries, wrappedBy) => {
  if (!entries?.length) return;
  const ops = entries.map((e) => ({
    updateOne: {
      filter: {
        groupId,
        userId: e.userId,
        version: e.version,
      },
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
  }));
  await groupKeyRepository.bulkWrite(ops, { ordered: false });
};

export const requestKeyRotation = async (group, reason) => {
  if (!(await getLatestKeyVersion(group._id))) return;
  const adminIds = group.members
    .filter((m) => m.role === "admin")
    .map((m) => sid(m.userId));
  broadcastGroupKeyRotationRequired(adminIds, {
    groupId: String(group._id),
    reason,
  });
};

export const notifyKeysNeeded = async (group, newIds) => {
  if (!(await getLatestKeyVersion(group._id))) return;
  const skip = new Set(newIds.map(String));
  const targetIds = group.members
    .filter((m) => !skip.has(sid(m.userId)))
    .map((m) => sid(m.userId));
  groupId: (String(group._id),
    broadcastGroupKeysNeeded(targetIds, {
      userIds: newIds.map(String),
    }));
};

export const loadGroup = (id) =>
  groupRepository
    .findById(id)
    .populate("members.userId", "fullName avatar profilePhotoVisibility");

export const formatGroup = (
  group,
  extra = {},
  viewerId = null,
  targetSavedViewerSet = null,
  blockedSet = null,
) => {
  const vId = viewerId ? String(viewerId) : null;
  return {
    id: group._id,
    name: group.name,
    avatar: group.avatar?.url || "",
    owner: sid(group.owner),
    members: group.members.map((m) => {
      const u = m.userId;
      const uid = sid(u);
      const isSelf = vId && uid === vId;
      const isBlocked = blockedSet ? blockedSet.has(uid) : false;

      let showPhoto = true;
      if (vId && !isSelf) {
        if (isBlocked) {
          showPhoto = false;
        } else {
          const vis = u?.profilePhotoVisibility ?? "everyone";
          showPhoto = canViewSync(vis, uid, vId, targetSavedViewerSet);
        }
      }

      return {
        id: uid,
        fullName: u?.fullName || "",
        avatar: showPhoto ? u?.avatar?.url || "" : "",
        role: m.role,
        joinedAt: m.joinedAt,
      };
    }),
    createdAt: group.createdAt,
    lastMessageAt: group.lastMessageAt || group.createdAt,
    unreadCount: 0,
    lastMessage: null,
    archived: false,
    e2ee: false,
    keyVersion: 0,
    keyRotationPending: !!group.keyRotationPending,
    ...extra,
  };
};

export const presentGroup = async (group, extra = {}, viewerId = null) => {
  const keyVersion = await getLatestKeyVersion(group._id);
  let targetSavedViewerSet = null;
  let blockedSet = null;

  if (viewerId) {
    const memberIds = group.members
      .map((m) => m.userId?._id || m.userId)
      .filter(Boolean);
    const [savedContacts, blockers, meDoc] = await Promise.all([
      contactRepository
        .find({ ownerId: { $in: memberIds }, contactId: viewerId })
        .select("ownerId")
        .lean(),
      userRepository
        .find({ _id: { $in: memberIds }, blockedUsers: viewerId })
        .select("_id")
        .lean(),
      userRepository.findById(viewerId).select("blockedUsers").lean(),
    ]);
    targetSavedViewerSet = new Set(savedContacts.map((c) => String(c.ownerId)));
    blockedSet = new Set([
      ...blockers.map((b) => String(b._id)),
      ...(meDoc?.blockedUsers || []).map(String),
    ]);
  }

  return formatGroup(
    group,
    { e2ee: keyVersion > 0, keyVersion, ...extra },
    viewerId,
    targetSavedViewerSet,
    blockedSet,
  );
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
    isEdited: Boolean(msg.isEdited),
    editedAt: msg.editedAt || null,
    createdAt: msg.createdAt,
  };
};

export const joinRoom = joinGroupRoom;
export const leaveRoom = leaveGroupRoom;
export const emitToMembers = emitToGroupMembers;

export const emitGroupToMembers = async (
  group,
  event,
  exceptIds = [],
  extra = {},
) => {
  const skip = new Set(exceptIds.map(String));
  const memberIds = group.members.map((m) => sid(m.userId)).filter(Boolean);
  const recipientIds = memberIds.filter((id) => !skip.has(id));
  if (!recipientIds.length) return;

  const keyVersion = await getLatestKeyVersion(group._id);

  const [memberUsers, contacts] = await Promise.all([
    userRepository
      .find({ _id: { $in: memberIds } })
      .select("_id blockedUsers")
      .lean(),
    contactRepository
      .find({
        ownerId: { $in: memberIds },
        contactId: { $in: memberIds },
      })
      .select("ownerId contactId")
      .lean(),
  ]);

  const blockedByMap = new Map();
  for (const u of memberUsers) {
    blockedByMap.set(
      String(u._id),
      new Set((u.blockedUsers || []).map(String)),
    );
  }

  const savedByMap = new Map();
  for (const c of contacts) {
    const cid = String(c.contactId);
    const oid = String(c.ownerId);
    if (!savedByMap.has(cid)) savedByMap.set(cid, new Set());
    savedByMap.get(cid).add(oid);
  }

  for (const uid of recipientIds) {
    const targetSavedViewerSet = savedByMap.get(uid) || new Set();
    const blockedSet = new Set();
    const myBlocked = blockedByMap.get(uid) || new Set();

    for (const otherId of memberIds) {
      if (otherId === uid) continue;
      if (
        myBlocked.has(otherId) ||
        (blockedByMap.get(otherId) && blockedByMap.get(otherId).has(uid))
      ) {
        blockedSet.add(otherId);
      }
    }

    const personalized = formatGroup(
      group,
      { e2ee: keyVersion > 0, keyVersion, ...extra },
      uid,
      targetSavedViewerSet,
      blockedSet,
    );

    emitToUser(uid, event, personalized);
  }
};

export const emitToViewers = async (group, sharerId, event, payload) => {
  const memberIds = group.members.map((m) => sid(m.userId));
  const [blockers, blockedBySharer] = await Promise.all([
    getBlockersOf(memberIds, sharerId),
    getBlockedByMe(sharerId),
  ]);
  const blockedSet = new Set([...blockedBySharer].map(String));
  const allowed = memberIds.filter(
    (id) => !blockers.has(id) && !blockedSet.has(id),
  );
  for (const uid of allowed) {
    emitToUser(uid, event, payload);
  }
};

export const getUnread = (groupId, userId, joinedAt, blockedIds) =>
  groupMessageRepository.countDocuments({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: [...blockedIds, userId] },
    readBy: { $ne: userId },
    silentReadBy: { $ne: userId },
  });

export const getLast = (groupId, joinedAt, blockedIds) =>
  groupMessageRepository
    .findOne({
      groupId,
      createdAt: { $gte: joinedAt },
      senderId: { $nin: blockedIds },
    })
    .sort({ createdAt: -1 })
    .populate("senderId", "fullName avatar profilePhotoVisibility");

export const emitMemberConversation = async (groupId, member) => {
  const uid = sid(member.userId);
  const blocked = await getBlockedByMe(uid);
  const [unreadCount, last] = await Promise.all([
    getUnread(groupId, uid, member.joinedAt, blocked),
    getLast(groupId, member.joinedAt, blocked),
  ]);

  let formattedLast = null;
  if (last) {
    formattedLast = formatGroupMessage(last);
    if (formattedLast?.sender && last.senderId) {
      const sId = sid(last.senderId);
      if (sId !== uid) {
        const canView = await canViewProfilePhoto(uid, sId);
        if (!canView) {
          formattedLast.sender.avatar = "";
        }
      }
    }
  }

  emitGroupConversationUpdate(uid, {
    groupId: String(groupId),
    unreadCount,
    lastMessage: formattedLast,
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
  await message.populate("senderId", "fullName avatar profilePhotoVisibility");
  await groupRepository.updateOne(
    { _id: group._id },
    { lastMessageAt: message.createdAt },
  );

  const sender = message.senderId;
  const sId = sid(sender);
  const vis = sender?.profilePhotoVisibility ?? "everyone";

  const memberIds = group.members.map((m) => sid(m.userId));
  const blockers = await getBlockersOf(memberIds, senderId);
  const eligibleMemberIds = memberIds.filter((id) => !blockers.has(id));

  let contactsWhoSavedSender = new Set();
  if (vis === "contacts") {
    const contacts = await contactRepository
      .find({
        ownerId: sId,
        contactId: { $in: eligibleMemberIds },
      })
      .select("contactId")
      .lean();
    contactsWhoSavedSender = new Set(contacts.map((c) => String(c.contactId)));
  }

  const basePayload = formatGroupMessage(message);

  for (const id of eligibleMemberIds) {
    const isSelf = id === sId;
    let canSeePhoto = isSelf;
    if (!isSelf) {
      if (vis === "everyone") canSeePhoto = true;
      else if (vis === "contacts") canSeePhoto = contactsWhoSavedSender.has(id);
      else canSeePhoto = false;
    }

    const memberPayload = canSeePhoto
      ? basePayload
      : {
          ...basePayload,
          sender: basePayload.sender
            ? { ...basePayload.sender, avatar: "" }
            : null,
        };

    emitToUser(id, GROUP_SOCKET_EVENTS.GROUP_NEW_MESSAGE, memberPayload);
  }

  console.log(
    `[group-delivery] message ${message._id} saved for group ${group._id}. Broadcasted to ${eligibleMemberIds.length} members`,
  );

  emitGroupConversation(group);

  return basePayload;
};

export const lastUpdateAt = new Map();

export const endShare = async (group, share, status = "stopped") => {
  const result = await locationShareRepository.updateOne(
    { _id: share._id, status: "active" },
    { status, endedAt: new Date() },
  );
  lastUpdateAt.delete(String(share._id));
  if (!result.modifiedCount) return false;

  if (share.messageId) {
    await groupMessageRepository.updateOne(
      { _id: share.messageId },
      { "location.isLive": false },
    );
  }

  emitToGroupRoom(group._id, GROUP_SOCKET_EVENTS.GROUP_LOCATION_ENDED, {
    groupId: String(group._id),
    shareId: String(share._id),
  });
  return true;
};

export const stopUserShares = async (group, userId) => {
  const active = await locationShareRepository.find({
    groupId: group._id,
    sharerId: userId,
    status: "active",
  });
  for (const s of active) {
    await endShare(group, s, "stopped");
  }
};

export const deleteMedia = (m) => {
  if (!m) return [];
  const tasks = [];
  if (m.image?.public_id) {
    tasks.push(deleteFileToCloudinary(m.image.public_id, "image"));
  }
  if (m.file?.public_id) {
    tasks.push(
      deleteFileToCloudinary(m.file.public_id, m.file.resourceType || "raw"),
    );
  }
  if (m.audio?.public_id) {
    tasks.push(
      deleteFileToCloudinary(
        m.audio.public_id,
        m.audio.resourceType || "video",
      ),
    );
  }
  if (m.video?.public_id) {
    tasks.push(
      deleteFileToCloudinary(
        m.video.public_id,
        m.video.resourceType || "video",
      ),
    );
  }
  return tasks;
};

export const findGroupMessageDuplicate = (groupId, senderId, clientId) =>
  groupMessageRepository
    .findOne({ groupId, senderId, clientId })
    .populate("senderId", "fullName avatar");

export const destroyGroup = async (group) => {
  const media = await groupMessageRepository
    .find({
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

  await groupMessageRepository.deleteMany({ groupId: group._id });
  await groupArchiveRepository.deleteMany({ groupId: group._id });
  await locationShareRepository.deleteMany({ groupId: group._id });
  await groupKeyRepository.deleteMany({ groupId: group._id });
  await groupCallRepository.deleteMany({ groupId: group._id });
  terminateGroupCallByGroup(io, group._id, "group-deleted");
  await groupRepository.deleteOne({ _id: group._id });

  await Promise.allSettled([
    ...media.flatMap(deleteMedia),
    ...(group.avatar?.public_id
      ? [deleteFileToCloudinary(group.avatar.public_id, "image")]
      : []),
  ]);

  broadcastGroupDeleted(group, { groupId: String(group._id) });
};

export const deleteGroupService = async (group, me) => {
  if (sid(group.owner) !== String(me)) {
    throw new ApiError(StatusCodes.FORBIDDEN, GROUP_ERROR_MESSAGES.OWNER_ONLY);
  }
  await destroyGroup(group);
  return { groupId: String(group._id) };
};

export const getGroupDetails = async (groupId, me) => {
  const group = await loadGroup(groupId);
  if (!group) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.GROUP_NOT_FOUND,
    );
  }
  const isMember = group.members.some((m) => sid(m.userId) === String(me));
  if (!isMember) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.NOT_A_MEMBER,
    );
  }
  const archived = !!(await groupArchiveRepository.exists({
    ownerId: me,
    groupId: group._id,
  }));
  return presentGroup(group, { archived }, me);
};

export const updateGroupService = async ({ group, me, name, file }) => {
  let changed = false;
  let oldPublicId = null;
  let newAvatar = null;

  if (name !== undefined) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed && trimmed !== group.name) {
      group.name = trimmed;
      changed = true;
    }
  }

  try {
    if (file?.path) {
      oldPublicId = group.avatar?.public_id;
      newAvatar = await uploadImage(file);
      group.avatar = newAvatar;
      changed = true;
    }

    if (!changed) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.NO_CHANGES_TO_UPDATE,
      );
    }

    await group.save();

    if (oldPublicId) {
      await deleteFileToCloudinary(oldPublicId, "image").catch(() => {});
    }

    const full = await loadGroup(group._id);
    await emitGroupToMembers(full, GROUP_SOCKET_EVENTS.GROUP_UPDATED);
    return presentGroup(full, {}, me);
  } catch (error) {
    if (newAvatar?.public_id) {
      await deleteFileToCloudinary(newAvatar.public_id, "image").catch(
        () => {},
      );
    }
    throw error;
  } finally {
    if (file?.path) {
      await safeUnlink(file.path);
    }
  }
};

export const archiveGroupService = async (group, me) => {
  try {
    await groupArchiveRepository.updateOne(
      { ownerId: me, groupId: group._id },
      { $setOnInsert: { ownerId: me, groupId: group._id } },
      { upsert: true },
    );
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
  broadcastGroupArchiveChanged(me, {
    groupId: String(group._id),
    archived: true,
  });
};

export const unarchiveGroupService = async (group, me) => {
  await groupArchiveRepository.deleteOne({ ownerId: me, groupId: group._id });
  broadcastGroupArchiveChanged(me, {
    groupId: String(group._id),
    archived: false,
  });
};

export const getMyGroupsList = async (me) => {
  const [groups, blocked, archivedSet] = await Promise.all([
    groupRepository
      .find({ "members.userId": me })
      .populate("members.userId", "fullName avatar profilePhotoVisibility"),
    getBlockedByMe(me),
    getArchivedGroupSet(me),
  ]);

  const versions = await getLatestVersions(groups.map((g) => g._id));
  const allMemberIds = [
    ...new Set(
      groups.flatMap((g) =>
        g.members.map((m) => m.userId?._id || m.userId).filter(Boolean),
      ),
    ),
  ];

  const [savedContacts, allBlockers] = await Promise.all([
    contactRepository
      .find({ ownerId: { $in: allMemberIds }, contactId: me })
      .select("ownerId")
      .lean(),
    userRepository
      .find({ _id: { $in: allMemberIds }, blockedUsers: me })
      .select("_id")
      .lean(),
  ]);

  const targetSavedViewerSet = new Set(
    savedContacts.map((c) => String(c.ownerId)),
  );
  const blockedMeSet = new Set(allBlockers.map((b) => String(b._id)));
  const myBlockedSet = new Set(blocked.map(String));
  const fullBlockedSet = new Set([...blockedMeSet, ...myBlockedSet]);

  const formattedGroups = await Promise.all(
    groups.map(async (g) => {
      const mine = g.members.find((m) => sid(m.userId) === String(me));
      const joinedAt = mine?.joinedAt || new Date(0);
      const v = versions.get(String(g._id)) || 0;
      const unreadCount = await getUnread(g._id, me, joinedAt, blocked);
      const last = await getLast(g._id, joinedAt, blocked);

      let formattedLast = null;
      if (last) {
        formattedLast = formatGroupMessage(last);
        if (formattedLast?.sender && last.senderId) {
          const sId = sid(last.senderId);
          if (sId !== String(me)) {
            const canView = await canViewProfilePhoto(me, sId);
            if (!canView) {
              formattedLast.sender.avatar = "";
            }
          }
        }
      }

      return formatGroup(
        g,
        {
          unreadCount,
          lastMessage: formattedLast,
          lastMessageAt: last?.createdAt ?? g.lastMessageAt ?? g.createdAt,
          archived: archivedSet.has(g._id.toString()),
          e2ee: v > 0,
          keyVersion: v,
        },
        me,
        targetSavedViewerSet,
        fullBlockedSet,
      );
    }),
  );

  return formattedGroups.sort(
    (a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0),
  );
};

export const validateGroupMessageInput = async (group, me, body, file) => {
  const wantsE2EE = parseBool(body.encrypted ?? body.e2ee);
  const text = wantsE2EE
    ? typeof body.text === "string"
      ? body.text
      : ""
    : body.text?.trim();
  const isVoice = body.isVoice === "true" || body.isVoice === true;
  const isVideo = body.isVideo === "true" || body.isVideo === true;

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
  const isLikelyAudio =
    file?.mimetype?.startsWith("audio/") ||
    /\.(m4a|aac|mp3|wav|ogg|opus|weba)$/i.test(file?.originalname || "");
  if (isVoice && file && !isLikelyAudio) {
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

    const hasKey = await groupKeyRepository.exists({
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

export const updateGroupForRequest = async ({ groupId, me, name, file }) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  assertAdmin(member);
  return updateGroupService({ group, me, name, file });
};

export const deleteGroupForRequest = async ({ groupId, me }) => {
  const { group } = await getGroupAndMember(groupId, me);
  return deleteGroupService(group, me);
};

export const archiveGroupForRequest = async ({ groupId, me }) => {
  const { group } = await getGroupAndMember(groupId, me);
  await archiveGroupService(group, me);
  return { groupId: String(group._id), archived: true };
};

export const unarchiveGroupForRequest = async ({ groupId, me }) => {
  const { group } = await getGroupAndMember(groupId, me);
  await unarchiveGroupService(group, me);
  return { groupId: String(group._id), archived: false };
};

const groupService = {
  getMyGroupsList,
  getGroupDetails,
  updateGroupService,
  deleteGroupService,
  archiveGroupService,
  unarchiveGroupService,
  updateGroupForRequest,
  deleteGroupForRequest,
  archiveGroupForRequest,
  unarchiveGroupForRequest,
  safeUnlink,
  sid,
  getLatestKeyVersion,
  getLatestVersions,
  storeGroupKeys,
  requestKeyRotation,
  notifyKeysNeeded,
  loadGroup,
  formatGroup,
  presentGroup,
  formatGroupMessage,
  joinRoom,
  leaveRoom,
  emitToMembers,
  emitGroupToMembers,
  emitToViewers,
  getUnread,
  getLast,
  emitMemberConversation,
  emitGroupConversation,
  broadcastGroupMessage,
  lastUpdateAt,
  endShare,
  stopUserShares,
  deleteMedia,
  findGroupMessageDuplicate,
  destroyGroup,
  validateGroupMessageInput,
};

export default groupService;
