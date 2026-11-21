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
import { isUnlockTokenValid } from "../../users/utils/lock-token.util.js";
import { getOrFetchPrivacy } from "../../../infrastructure/socket/socket-state.js";
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
import * as notificationService from "../../notifications/services/notification.service.js";

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
  broadcastGroupKeysNeeded(targetIds, {
    groupId: String(group._id),
    userIds: newIds.map(String),
  });
};

export const loadGroup = (id) =>
  groupRepository
    .findById(id)
    .populate("members.userId", "fullName avatar username profilePhotoVisibility profilePhotoExceptions");

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
          showPhoto = canViewSync(
            vis,
            uid,
            vId,
            targetSavedViewerSet,
            u?.profilePhotoExceptions || [],
          );
        }
      }

      return {
        id: uid,
        fullName: u?.fullName || "",
        username: u?.username || "",
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
    isLocked: !!extra.isLocked,
    e2ee: false,
    keyVersion: 0,
    keyRotationPending: !!group.keyRotationPending,
    disappearAfter: group.disappearAfter || 0,
    whoCanPin: group.whoCanPin || "all",
    mentionAllPermission: group.mentionAllPermission || "everyone",
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

const formatGroupReply = (r) => {
  if (!r || typeof r !== "object" || !r.senderId) return null;
  if (r.isDeleted) return { id: String(r._id), isDeleted: true };

  const isEncrypted = Boolean(r.e2ee);
  const hasLocation =
    Number.isFinite(r.location?.lat) && Number.isFinite(r.location?.lng);
  return {
    id: String(r._id),
    senderId: String(r.senderId?._id || r.senderId),
    text: isEncrypted ? "" : (r.text || "").slice(0, 120),
    encrypted: isEncrypted,
    e2ee: isEncrypted,
    type: r.gift?.name
      ? "gift"
      : r.image?.url
        ? "image"
        : r.video?.url
          ? "video"
          : r.audio?.url
            ? "audio"
            : r.file?.url
              ? "file"
              : hasLocation
                ? "location"
                : "text",
    gift: r.gift?.name
      ? {
          name: r.gift.name,
          slug: r.gift.slug || "",
          icon: r.gift.icon,
          image: r.gift.image || "",
          category: r.gift.category,
          coinPrice: r.gift.coinPrice || 0,
          color: r.gift.color,
          message: r.gift.message,
        }
      : null,
    image: r.image?.url ? { url: r.image.url } : null,
    file: r.file?.url ? { name: r.file.name } : null,
    audio: r.audio?.url
      ? { url: r.audio.url, duration: r.audio.duration || 0 }
      : null,
    video: r.video?.url
      ? { url: r.video.url, duration: r.video.duration || 0 }
      : null,
    location: hasLocation ? { lat: r.location.lat, lng: r.location.lng } : null,
    isDeleted: false,
  };
};

export const formatGroupMessage = (msg, viewerId = null) => {
  const isDeleted = Boolean(msg.isDeleted);
  const sender = msg.senderId?._id ? msg.senderId : null;
  const hasLocation =
    !isDeleted &&
    Number.isFinite(msg.location?.lat) && Number.isFinite(msg.location?.lng);

  return {
    id: String(msg._id),
    groupId: sid(msg.groupId),
    senderId: sid(msg.senderId),
    sender: sender
      ? {
          id: sid(sender),
          fullName: sender.fullName || "",
          username: sender.username || "",
          avatar:
            sender.avatar?.url ||
            (typeof sender.avatar === "string" ? sender.avatar : "") ||
            sender.profilePic ||
            "",
        }
      : null,
    text: isDeleted ? "" : (msg.text || ""),
    e2ee: isDeleted ? false : !!msg.e2ee,
    encrypted: isDeleted ? false : !!msg.e2ee,
    iv: isDeleted ? null : (msg.e2ee ? msg.iv || null : null),
    keyVersion: isDeleted ? null : (msg.e2ee ? (msg.keyVersion ?? null) : null),
    image:
      !isDeleted && msg.image?.url
        ? { url: msg.image.url, public_id: msg.image.public_id }
        : null,
    file:
      !isDeleted && msg.file?.url
        ? {
            url: msg.file.url,
            name: msg.file.name,
            size: msg.file.size,
            mimeType: msg.file.mimeType,
          }
        : null,
    audio:
      !isDeleted && msg.audio?.url
        ? {
            url: msg.audio.url,
            duration: msg.audio.duration || 0,
            mimeType: msg.audio.mimeType || "audio/mp4",
          }
        : null,
    video:
      !isDeleted && msg.video?.url
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
    silentReadBy: (msg.silentReadBy || []).map(String),
    reactions: isDeleted
      ? []
      : (msg.reactions || []).map((r) => ({
          userId: String(r.userId?._id || r.userId),
          emoji: r.emoji,
          createdAt: r.createdAt,
        })),
    parentMessageId: msg.parentMessageId ? String(msg.parentMessageId) : null,
    threadReplyCount: msg.threadReplyCount || 0,
    threadLastReplyAt: msg.threadLastReplyAt || null,
    threadParticipants: Array.isArray(msg.threadParticipants)
      ? msg.threadParticipants.map((p) => String(p._id || p))
      : [],
    poll: msg.poll?.question ? msg.poll : null,
    gift:
      !isDeleted && msg.gift?.name
        ? {
            id: msg.gift.id,
            giftId: msg.gift.giftId || msg.gift.id,
            name: msg.gift.name,
            slug: msg.gift.slug || "",
            icon: msg.gift.icon,
            image: msg.gift.image || "",
            category: msg.gift.category,
            coinPrice: msg.gift.coinPrice || 0,
            rarity: msg.gift.rarity || "common",
            badge: msg.gift.badge || "",
            animation: msg.gift.animation,
            color: msg.gift.color,
            message: msg.gift.message,
            senderName: msg.gift.senderName,
          }
        : null,
    messageType: msg.messageType || (msg.gift?.name ? "gift" : "text"),
    isViewOnce: Boolean(msg.isViewOnce),
    viewOnceViewedBy: Array.isArray(msg.viewOnceViewedBy)
      ? msg.viewOnceViewedBy.map((u) => String(u._id || u))
      : [],
    viewOnceExpired: Boolean(msg.viewOnceExpired),
    expiresAt: msg.expiresAt || null,
    replyTo: isDeleted ? null : formatGroupReply(msg.replyTo),
    isForwarded: Boolean(msg.isForwarded),
    isPinned: isDeleted ? false : Boolean(msg.isPinned),
    pinnedBy:
      !isDeleted && msg.pinnedBy
        ? String(msg.pinnedBy?._id || msg.pinnedBy)
        : null,
    pinnedByUser:
      !isDeleted && msg.pinnedBy?._id
        ? {
            id: String(msg.pinnedBy._id),
            _id: String(msg.pinnedBy._id),
            fullName: msg.pinnedBy.fullName,
            avatar: msg.pinnedBy.avatar?.url || "",
          }
        : null,
    pinnedAt: !isDeleted && msg.pinnedAt ? msg.pinnedAt : null,
    isStarred: Boolean(
      viewerId &&
        Array.isArray(msg.starredBy) &&
        msg.starredBy.some((id) => String(id) === String(viewerId)),
    ),
    starredBy: Array.isArray(msg.starredBy) ? msg.starredBy.map(String) : [],
    mentionAll: Boolean(msg.mentionAll),
    mentions: Array.isArray(msg.mentions)
      ? msg.mentions.map((m) => {
          const u = m.userId?._id ? m.userId : null;
          return {
            userId: String(u ? u._id : m.userId),
            user: u
              ? {
                  id: String(u._id),
                  _id: String(u._id),
                  fullName: u.fullName,
                  avatar: u.avatar?.url || "",
                  username: u.username || "",
                }
              : null,
            startIndex: typeof m.startIndex === "number" ? m.startIndex : 0,
            length: typeof m.length === "number" ? m.length : 0,
          };
        })
      : [],
    isDeleted: isDeleted,
    deletedAt: msg.deletedAt || null,
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
    .populate("senderId", "fullName avatar profilePhotoVisibility profilePhotoExceptions");

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
  await message.populate([
    {
      path: "senderId",
      select: "fullName avatar profilePhotoVisibility profilePhotoExceptions",
    },
    { path: "mentions.userId", select: "fullName avatar username" },
  ]);
  await groupRepository.updateOne(
    { _id: group._id },
    { lastMessageAt: message.createdAt },
  );

  const sender = message.senderId;
  const sId = sid(sender);
  const vis = sender?.profilePhotoVisibility ?? "everyone";

  const memberIds = group.members.map((m) => sid(m.userId));
  const blockers = await getBlockersOf(memberIds, senderId);
  const eligibleMemberIds = [
    ...new Set(memberIds.filter((id) => !blockers.has(id))),
  ];

  let contactsWhoSavedSender = new Set();
  if (vis === "contacts" || vis === "contacts_except") {
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
  const exceptions = sender?.profilePhotoExceptions || [];

  for (const id of eligibleMemberIds) {
    const isSelf = id === sId;
    let canSeePhoto = isSelf;
    if (!isSelf) {
      canSeePhoto = canViewSync(
        vis,
        sId,
        id,
        contactsWhoSavedSender.has(id),
        exceptions,
      );
    }

    let isMemberLocked = false;
    if (!isSelf) {
      const memberPrivacy = await getOrFetchPrivacy(id);
      isMemberLocked = (memberPrivacy?.lockedChats || []).includes(String(group._id));
    }

    if (isMemberLocked) {
      const redactedGroupPayload = {
        id: basePayload.id,
        _id: basePayload.id,
        groupId: basePayload.groupId,
        senderId: basePayload.senderId,
        isLocked: true,
        createdAt: basePayload.createdAt,
        updatedAt: basePayload.updatedAt,
      };
      emitToUser(id, GROUP_SOCKET_EVENTS.GROUP_NEW_MESSAGE, redactedGroupPayload);
    } else {
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

    if (!isSelf) {
      const isMentionAll = Boolean(message.mentionAll);
      const isMentioned =
        isMentionAll ||
        (Array.isArray(message.mentions) &&
          message.mentions.some(
            (m) => String(m.userId?._id || m.userId) === id,
          ));

      let groupNotifType = "group_message_received";
      let groupNotifTitle = group.name || "Group";
      let groupNotifBody = "New message";

      if (isMentionAll) {
        groupNotifType = "group_mention_all";
        groupNotifTitle = `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}`;
        groupNotifBody = `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}`;
      } else if (isMentioned) {
        groupNotifType = "group_mention";
        groupNotifTitle = "You were mentioned";
        groupNotifBody = `${sender?.fullName || "Someone"} mentioned you in ${group.name}`;
      } else if (message.replyTo && String(message.replyTo.senderId) === id) {
        groupNotifType = "group_reply";
        groupNotifTitle = `${sender?.fullName || "Someone"} replied in ${group.name}`;
      }

      if (message.image?.url) {
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}: Sent a photo`
          : `${sender?.fullName || "Someone"}: Sent a photo`;
      } else if (message.video?.url) {
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}: Sent a video`
          : `${sender?.fullName || "Someone"}: Sent a video`;
      } else if (message.audio?.url) {
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}: Sent a voice message`
          : `${sender?.fullName || "Someone"}: Sent a voice message`;
      } else if (message.file?.url) {
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}: Sent a document`
          : `${sender?.fullName || "Someone"}: Sent a document`;
      } else if (message.location?.lat != null) {
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}: Shared location`
          : `${sender?.fullName || "Someone"}: Shared location`;
      } else if (message.gift?.name) {
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}: Sent a gift ${message.gift.icon || "🎁"} ${message.gift.name}`
          : `${sender?.fullName || "Someone"}: Sent a gift ${message.gift.icon || "🎁"} ${message.gift.name}`;
      } else if (message.e2ee) {
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}`
          : isMentioned
            ? `${sender?.fullName || "Someone"} mentioned you in ${group.name}`
            : `${sender?.fullName || "Someone"}: New encrypted message`;
      } else if (message.text) {
        const preview =
          message.text.length > 60
            ? `${message.text.slice(0, 60)}…`
            : message.text;
        groupNotifBody = isMentionAll
          ? `${sender?.fullName || "Someone"} mentioned everyone in ${group.name}: ${preview}`
          : isMentioned
            ? `${sender?.fullName || "Someone"} mentioned you in ${group.name}: ${preview}`
            : `${sender?.fullName || "Someone"}: ${preview}`;
      }

      notificationService
        .dispatchNotification({
          recipientId: id,
          senderId: sId,
          category: "group",
          type: groupNotifType,
          title: groupNotifTitle,
          body: groupNotifBody,
          data: {
            groupId: String(group._id),
            messageId: String(message._id),
            senderId: sId,
            senderName: sender?.fullName || "Someone",
            groupName: group.name,
            mentionType: isMentionAll ? "all" : isMentioned ? "user" : undefined,
            mentionedUserId: isMentioned ? id : undefined,
            timestamp: message.createdAt || new Date(),
          },
          dedupKey: isMentionAll
            ? `group_mention_all:${message._id}:${id}`
            : isMentioned
              ? `group_mention:${message._id}:${id}`
              : null,
        })
        .catch(() => {});
    }
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
  await userRepository.updateMany(
    { lockedChats: String(group._id) },
    { $pull: { lockedChats: String(group._id) } },
  );
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

export const updateGroupService = async ({ group, me, name, file, whoCanPin, mentionAllPermission }) => {
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

  if (whoCanPin !== undefined && ["all", "admins"].includes(whoCanPin)) {
    if (group.whoCanPin !== whoCanPin) {
      group.whoCanPin = whoCanPin;
      changed = true;
    }
  }

  if (
    mentionAllPermission !== undefined &&
    ["everyone", "admins_only", "disabled"].includes(mentionAllPermission)
  ) {
    if (group.mentionAllPermission !== mentionAllPermission) {
      group.mentionAllPermission = mentionAllPermission;
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

export const getMyGroupsList = async (me, options = {}) => {
  const [groups, blocked, archivedSet, meDoc] = await Promise.all([
    groupRepository
      .find({ "members.userId": me })
      .populate("members.userId", "fullName avatar profilePhotoVisibility profilePhotoExceptions"),
    getBlockedByMe(me),
    getArchivedGroupSet(me),
    userRepository.findById(me).select("lockedChats +lockEpoch").lean(),
  ]);

  const myLockedSet = new Set((meDoc?.lockedChats || []).map(String));
  let isAppUnlocked = false;
  if (options?.unlockToken && meDoc) {
    if (
      isUnlockTokenValid(
        options.unlockToken,
        me,
        options.sessionId,
        "app",
        meDoc.lockEpoch,
      )
    ) {
      isAppUnlocked = true;
    }
  }

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

      const isLocked = myLockedSet.has(String(g._id));
      let isUnlocked = isAppUnlocked;
      if (isLocked && !isUnlocked && options?.unlockToken && meDoc) {
        if (
          isUnlockTokenValid(
            options.unlockToken,
            me,
            options.sessionId,
            String(g._id),
            meDoc.lockEpoch,
          )
        ) {
          isUnlocked = true;
        }
      }

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

      if (isLocked && !isUnlocked && formattedLast) {
        formattedLast = {
          id: formattedLast.id,
          _id: formattedLast.id,
          groupId: formattedLast.groupId,
          senderId: formattedLast.senderId,
          isLocked: true,
          createdAt: formattedLast.createdAt,
          updatedAt: formattedLast.updatedAt,
        };
      }

      return formatGroup(
        g,
        {
          unreadCount,
          lastMessage: formattedLast,
          lastMessageAt: last?.createdAt ?? g.lastMessageAt ?? g.createdAt,
          archived: archivedSet.has(g._id.toString()),
          isLocked,
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

  let parsedGift = null;
  if (body.gift) {
    try {
      parsedGift =
        typeof body.gift === "string" ? JSON.parse(body.gift) : body.gift;
    } catch (_e) {}
  }

  if (!text && !file && !parsedGift?.name) {
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

  return { text, cipher, wantsE2EE, isVoice, isVideo, gift: parsedGift };
};

export const updateGroupForRequest = async ({
  groupId,
  me,
  name,
  file,
  whoCanPin,
  mentionAllPermission,
}) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  assertAdmin(member);
  return updateGroupService({ group, me, name, file, whoCanPin, mentionAllPermission });
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
