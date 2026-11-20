import fs from "fs/promises";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import { io } from "../../../infrastructure/socket/socket.js";
import * as groupMessageRepository from "../repositories/group-message.repository.js";
import * as contactRepository from "../../contacts/repositories/contact.repository.js";
import User from "../../users/models/users.model.js";
import * as notificationService from "../../notifications/services/notification.service.js";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_CATEGORIES,
} from "../../notifications/models/notification.model.js";
import { readClientId, assertValidId } from "../../../shared/utils/validators.js";
import { parseBool, assertValidCipher } from "../../messaging/utils/e2ee.js";
import { canViewSync } from "../../privacy/services/privacy-visibility.service.js";
import { getBlockedByMe, getGroupAndMember } from "../helpers/group.member.helpers.js";
import { getPrivacy } from "../../../infrastructure/socket/socket-state.js";
import { uploadAttachment } from "./group-media.service.js";
import {
  canDeleteMessage,
  canEditMessage,
} from "../policies/group.policy.js";
import {
  broadcastGroupMessageEdited,
  broadcastGroupMessageDeleted,
  emitToGroupRoom,
  emitToUser,
} from "../events/group.events.js";
import {
  EDIT_WINDOW_MS,
  GROUP_ERROR_MESSAGES,
} from "../constants/index.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";
import {
  sid,
  formatGroupMessage,
  deleteMedia,
  findGroupMessageDuplicate,
  broadcastGroupMessage,
  emitGroupConversation,
  emitMemberConversation,
  validateGroupMessageInput,
  endShare,
} from "./group.service.js";

export const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (_err) {}
};

export const isTextOnlyMessage = (message) => {
  if (!message) return false;
  return !(
    message.image?.url ||
    message.file?.url ||
    message.audio?.url ||
    message.video?.url ||
    message.location?.lat != null ||
    message.location?.lng != null ||
    message.location?.shareId != null
  );
};

export const getGroupMessagesList = async ({ group, member, me, query }) => {
  const blocked = await getBlockedByMe(me);
  const limit = Math.min(Number(query.limit) || 100, 200);
  const createdAt = { $gte: member.joinedAt };

  if (query.before) {
    const d = new Date(query.before);
    if (!Number.isNaN(d.getTime())) createdAt.$lt = d;
  }
  if (query.after) {
    const d = new Date(query.after);
    if (!Number.isNaN(d.getTime())) {
      const minDate = d > member.joinedAt ? d : member.joinedAt;
      createdAt.$gt = minDate;
    }
  }

  const msgs = await groupMessageRepository
    .find({
      groupId: group._id,
      parentMessageId: { $in: [null, undefined] },
      createdAt,
      senderId: { $nin: blocked },
      deletedFor: { $ne: me },
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("senderId", "fullName avatar profilePhotoVisibility profilePhotoExceptions")
    .populate("replyTo", "senderId text image file audio video location isDeleted e2ee iv")
    .populate("mentions.userId", "fullName avatar username");

  const senderIds = [
    ...new Set(msgs.map((m) => m.senderId?._id || m.senderId).filter(Boolean)),
  ];

  const contactsWhoSavedMe = await contactRepository
    .find({
      ownerId: { $in: senderIds },
      contactId: me,
    })
    .select("ownerId")
    .lean();

  const targetSavedMeSet = new Set(
    contactsWhoSavedMe.map((c) => String(c.ownerId)),
  );

  const myReceipts = getPrivacy(String(me)).readReceipts !== false;

  return msgs.reverse().map((m) => {
    const formatted = formatGroupMessage(m, me);
    const sender = m.senderId;
    if (sender) {
      const sId = sid(sender);
      if (sId !== String(me)) {
        const vis = sender.profilePhotoVisibility ?? "everyone";
        const canSeePhoto = canViewSync(
          vis,
          sId,
          me,
          targetSavedMeSet,
          sender.profilePhotoExceptions || [],
        );
        if (!canSeePhoto && formatted.sender) {
          formatted.sender.avatar = "";
        }
      }
    }

    // Mutual privacy: if viewer has read receipts OFF, hide readBy.
    // Also filter out any readers who currently have read receipts OFF.
    if (!myReceipts) {
      formatted.readBy = [];
    } else {
      formatted.readBy = (formatted.readBy || []).filter(
        (uId) => getPrivacy(String(uId)).readReceipts !== false,
      );
    }

    return formatted;
  });
};

export const sendGroupMessageService = async ({ group, me, body, file }) => {
  let attachment = {};
  let clientId = null;
  try {
    const { text, cipher, isVoice, isVideo } = await validateGroupMessageInput(
      group,
      me,
      body,
      file,
    );

    clientId = readClientId(body);

    if (clientId) {
      const dup = await findGroupMessageDuplicate(group._id, me, clientId);
      if (dup) {
        return { isDuplicate: true, payload: formatGroupMessage(dup) };
      }
    }

    if (file?.path) {
      attachment = await uploadAttachment(file, {
        isVoice,
        isVideo,
        duration: body.duration,
      });
    }

    let replyTo = null;
    if (body.replyTo) {
      assertValidId(body.replyTo, "reply ID");
      const orig = await groupMessageRepository.findOne({
        _id: body.replyTo,
        groupId: group._id,
        isDeleted: { $ne: true },
      });
      if (orig) replyTo = orig._id;
    }
    const isForwarded = parseBool(body.isForwarded);
    const isViewOnce = parseBool(body.isViewOnce);

    let expiresAt = null;
    if (body.expiresAt) {
      const exp = new Date(body.expiresAt);
      if (!isNaN(exp.getTime())) expiresAt = exp;
    } else if (group.disappearAfter && group.disappearAfter > 0) {
      expiresAt = new Date(Date.now() + group.disappearAfter * 1000);
    }

    // Parse and validate mentions
    let mentions = [];
    if (body.mentions) {
      try {
        const raw =
          typeof body.mentions === "string"
            ? JSON.parse(body.mentions)
            : body.mentions;
        if (Array.isArray(raw)) {
          const groupMemberIds = new Set(
            group.members.map((m) => String(m.userId?._id || m.userId)),
          );
          const seen = new Set();
          for (const item of raw) {
            const uid = String(item.userId || item.id || "");
            if (
              mongoose.Types.ObjectId.isValid(uid) &&
              groupMemberIds.has(uid) &&
              uid !== String(me) &&
              !seen.has(uid)
            ) {
              seen.add(uid);
              mentions.push({
                userId: new mongoose.Types.ObjectId(uid),
                startIndex:
                  typeof item.startIndex === "number" ? item.startIndex : 0,
                length: typeof item.length === "number" ? item.length : 0,
              });
            }
          }
        }
      } catch (_e) {}
    }

    const message = await groupMessageRepository.create({
      groupId: group._id,
      senderId: me,
      text,
      ...attachment,
      ...cipher,
      clientId,
      replyTo,
      isForwarded,
      isViewOnce,
      mentions,
      ...(expiresAt ? { expiresAt } : {}),
      ...(body.parentMessageId ? { parentMessageId: body.parentMessageId } : {}),
      readBy: [me],
    });

    if (replyTo) {
      await message.populate(
        "replyTo",
        "senderId text image file audio video location isDeleted e2ee iv",
      );
    }

    const payload = await broadcastGroupMessage(group, message, me);
    return { isDuplicate: false, payload };
  } catch (error) {
    if (attachment && Object.keys(attachment).length > 0) {
      await Promise.allSettled(deleteMedia(attachment));
    }
    if (error?.code === 11000 && clientId) {
      const dup = await findGroupMessageDuplicate(group._id, me, clientId);
      if (dup) {
        return { isDuplicate: true, payload: formatGroupMessage(dup) };
      }
    }
    throw error;
  } finally {
    if (file?.path) {
      await safeUnlink(file.path);
    }
  }
};

export const editGroupMessageService = async ({
  group,
  me,
  messageId,
  body,
}) => {
  const wantsE2EE = parseBool(body.encrypted ?? body.e2ee);
  const rawText = body.text;
  const iv = body.iv;

  if (typeof rawText !== "string" || !rawText) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.EMPTY_MESSAGE,
    );
  }

  const text = wantsE2EE ? rawText : rawText.trim();
  if (!text) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.EMPTY_MESSAGE,
    );
  }

  if (wantsE2EE) {
    assertValidCipher(text, iv);
  }

  const cutoff = new Date(Date.now() - EDIT_WINDOW_MS);

  let mentions = undefined;
  if (body.mentions) {
    try {
      const raw =
        typeof body.mentions === "string"
          ? JSON.parse(body.mentions)
          : body.mentions;
      if (Array.isArray(raw)) {
        const groupMemberIds = new Set(
          group.members.map((m) => String(m.userId?._id || m.userId)),
        );
        const seen = new Set();
        mentions = [];
        for (const item of raw) {
          const uid = String(item.userId || item.id || "");
          if (
            mongoose.Types.ObjectId.isValid(uid) &&
            groupMemberIds.has(uid) &&
            uid !== String(me) &&
            !seen.has(uid)
          ) {
            seen.add(uid);
            mentions.push({
              userId: new mongoose.Types.ObjectId(uid),
              startIndex:
                typeof item.startIndex === "number" ? item.startIndex : 0,
              length: typeof item.length === "number" ? item.length : 0,
            });
          }
        }
      }
    } catch (_e) {}
  }

  const updatedMessage = await groupMessageRepository
    .findOneAndUpdate(
      {
        _id: messageId,
        groupId: group._id,
        senderId: me,
        createdAt: { $gte: cutoff },
        e2ee: wantsE2EE,
        "image.url": { $in: [null, undefined] },
        "file.url": { $in: [null, undefined] },
        "audio.url": { $in: [null, undefined] },
        "video.url": { $in: [null, undefined] },
        "location.lat": { $in: [null, undefined] },
        "location.shareId": { $in: [null, undefined] },
      },
      {
        $set: {
          text,
          ...(wantsE2EE ? { iv } : {}),
          ...(mentions !== undefined ? { mentions } : {}),
          isEdited: true,
          editedAt: new Date(),
        },
      },
      { new: true },
    )
    .populate([
      {
        path: "senderId",
        select:
          "fullName avatar profilePhotoVisibility profilePhotoExceptions",
      },
      { path: "mentions.userId", select: "fullName avatar username" },
    ]);

  if (!updatedMessage) {
    const msg = await groupMessageRepository.findOne({
      _id: messageId,
      groupId: group._id,
    });
    if (!msg) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        GROUP_ERROR_MESSAGES.MESSAGE_NOT_FOUND,
      );
    }
    canEditMessage({ message: msg, actorId: me });
    if (!isTextOnlyMessage(msg)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.EDIT_ONLY_TEXT,
      );
    }
    if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.EDIT_TIME_OVER,
      );
    }
    if (Boolean(msg.e2ee) !== wantsE2EE) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.CANNOT_CHANGE_ENCRYPTION,
      );
    }
    throw new ApiError(StatusCodes.BAD_REQUEST, "Message could not be edited.");
  }

  const payload = formatGroupMessage(updatedMessage);
  broadcastGroupMessageEdited(group, payload);
  await emitGroupConversation(group);

  return { payload };
};

export const deleteGroupMessageService = async ({
  group,
  member,
  me,
  messageId,
}) => {
  const message = await groupMessageRepository.findById(messageId);
  if (!message || String(message.groupId) !== String(group._id)) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.MESSAGE_NOT_FOUND,
    );
  }

  canDeleteMessage({ group, member, message, actorId: me });

  if (message.isDeleted) {
    return {
      groupId: String(group._id),
      messageId: String(messageId),
      alreadyDeleted: true,
    };
  }

  if (message.location?.shareId) {
    await endShare(
      group,
      { _id: message.location.shareId, messageId: message._id },
      "stopped",
    );
  }

  await Promise.allSettled(deleteMedia(message));

  message.isDeleted = true;
  message.deletedAt = new Date();
  message.text = "";
  message.image = undefined;
  message.file = undefined;
  message.audio = undefined;
  message.video = undefined;
  message.location = undefined;
  message.isPinned = false;
  message.pinnedBy = undefined;
  message.pinnedAt = undefined;
  await message.save();

  if (message.parentMessageId) {
    const updatedParent = await groupMessageRepository.updateById(
      message.parentMessageId,
      { $inc: { threadReplyCount: -1 } },
      { new: true },
    );
    const count = Math.max(0, updatedParent?.threadReplyCount || 0);
    io.to(String(group._id)).emit("threadUpdated", {
      groupId: String(group._id),
      parentMessageId: String(message.parentMessageId),
      threadReplyCount: count,
    });
    io.to(String(group._id)).emit("groupThreadReplyDeleted", {
      groupId: String(group._id),
      parentMessageId: String(message.parentMessageId),
      replyId: String(message._id),
    });
  }

  const payload = {
    groupId: String(group._id),
    messageId: String(messageId),
  };

  broadcastGroupMessageDeleted(group, payload);
  await emitGroupConversation(group);

  return payload;
};

export const deleteGroupMessageForMeService = async ({
  group,
  me,
  messageId,
}) => {
  const message = await groupMessageRepository.findOne({
    _id: messageId,
    groupId: group._id,
  });
  if (!message) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.MESSAGE_NOT_FOUND,
    );
  }

  await groupMessageRepository.updateOne(
    { _id: messageId, groupId: group._id },
    { $addToSet: { deletedFor: me } },
  );

  emitToUser(me, GROUP_SOCKET_EVENTS.GROUP_MESSAGE_DELETED_FOR_ME, {
    groupId: String(group._id),
    messageId: String(messageId),
  });

  return {
    groupId: String(group._id),
    messageId: String(messageId),
    message: "Message deleted for you.",
  };
};

export const getPinnedGroupMessagesList = async ({ group, member, me }) => {
  const blocked = await getBlockedByMe(me);
  const msgs = await groupMessageRepository
    .find({
      groupId: group._id,
      parentMessageId: { $in: [null, undefined] },
      isPinned: true,
      isDeleted: { $ne: true },
      senderId: { $nin: blocked },
      deletedFor: { $ne: me },
    })
    .sort({ pinnedAt: -1 })
    .populate(
      "senderId",
      "fullName avatar profilePhotoVisibility profilePhotoExceptions",
    )
    .populate("pinnedBy", "fullName avatar")
    .populate(
      "replyTo",
      "senderId text image file audio video location isDeleted e2ee iv",
    );

  const senderIds = [
    ...new Set(msgs.map((m) => m.senderId?._id || m.senderId).filter(Boolean)),
  ];

  const contactsWhoSavedMe = await contactRepository
    .find({
      ownerId: { $in: senderIds },
      contactId: me,
    })
    .select("ownerId")
    .lean();

  const targetSavedMeSet = new Set(
    contactsWhoSavedMe.map((c) => String(c.ownerId)),
  );

  return msgs.map((m) => {
    const formatted = formatGroupMessage(m, me);
    const sender = m.senderId;
    if (sender) {
      const sId = sid(sender);
      if (sId !== String(me)) {
        const vis = sender.profilePhotoVisibility ?? "everyone";
        const canSeePhoto = canViewSync(
          vis,
          sId,
          me,
          targetSavedMeSet,
          sender.profilePhotoExceptions || [],
        );
        if (!canSeePhoto && formatted.sender) {
          formatted.sender.avatar = "";
        }
      }
    }
    return formatted;
  });
};

export const getPinnedGroupMessagesForRequest = async ({ groupId, me }) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  return getPinnedGroupMessagesList({ group, member, me });
};

export const togglePinGroupMessageService = async ({
  group,
  member,
  me,
  messageId,
}) => {
  const message = await groupMessageRepository.findOne({
    _id: messageId,
    groupId: group._id,
  });
  if (!message || message.isDeleted) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.MESSAGE_NOT_FOUND,
    );
  }

  const actor = String(me);
  const isAdminOrOwner =
    member?.role === "admin" || String(group.owner) === actor;
  const whoCanPin = group.whoCanPin || "all";

  if (whoCanPin === "admins" && !isAdminOrOwner) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only group admins can pin or unpin messages in this group.",
    );
  }

  if (!message.isPinned) {
    const pinCount = await groupMessageRepository.countDocuments({
      groupId: group._id,
      isPinned: true,
      isDeleted: { $ne: true },
    });
    if (pinCount >= 5) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You can pin up to 5 messages in this group.",
      );
    }
    message.isPinned = true;
    message.pinnedBy = me;
    message.pinnedAt = new Date();
  } else {
    message.isPinned = false;
    message.pinnedBy = undefined;
    message.pinnedAt = undefined;
  }

  await message.save();

  // Populate senderId and pinnedBy for rich payload
  await message.populate([
    {
      path: "senderId",
      select: "fullName avatar profilePhotoVisibility profilePhotoExceptions",
    },
    {
      path: "pinnedBy",
      select: "fullName avatar",
    },
  ]);

  const formattedMsg = formatGroupMessage(message, me);

  const payload = {
    groupId: String(group._id),
    messageId: String(message._id),
    isPinned: message.isPinned,
    pinnedBy: message.pinnedBy
      ? String(message.pinnedBy._id || message.pinnedBy)
      : null,
    pinnedByUser: message.pinnedBy?._id
      ? {
          id: String(message.pinnedBy._id),
          _id: String(message.pinnedBy._id),
          fullName: message.pinnedBy.fullName,
          avatar: message.pinnedBy.avatar?.url || "",
        }
      : null,
    pinnedAt: message.pinnedAt || null,
    message: formattedMsg,
  };

  emitToGroupRoom(group._id, GROUP_SOCKET_EVENTS.GROUP_MESSAGE_PINNED, payload);

  // Centralized real-time notification to group members
  if (message.isPinned) {
    const actorName = message.pinnedBy?.fullName || "A member";
    const notifPromises = [];
    for (const m of group.members || []) {
      const recipientId = String(m.userId?._id || m.userId);
      if (recipientId && recipientId !== actor) {
        notifPromises.push(
          notificationService.dispatchNotification({
            recipientId,
            senderId: actor,
            category: NOTIFICATION_CATEGORIES.GROUP,
            type: NOTIFICATION_TYPES.GROUP_MESSAGE_PINNED,
            title: `Pinned message in ${group.name}`,
            body: `${actorName} pinned a message: ${formattedMsg.text ? formattedMsg.text.slice(0, 50) : "Media"}`,
            data: {
              groupId: String(group._id),
              messageId: String(message._id),
            },
          }),
        );
      }
    }
    if (notifPromises.length > 0) {
      await Promise.allSettled(notifPromises);
    }
  }

  return payload;
};

export const toggleStarGroupMessageService = async ({
  group,
  me,
  messageId,
}) => {
  const message = await groupMessageRepository.findOne({
    _id: messageId,
    groupId: group._id,
  });
  if (!message || message.isDeleted) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.MESSAGE_NOT_FOUND,
    );
  }

  const uIdStr = String(me);
  const starredBy = Array.isArray(message.starredBy) ? message.starredBy : [];
  const idx = starredBy.findIndex((id) => String(id) === uIdStr);
  let isStarred = false;

  if (idx === -1) {
    message.starredBy.push(me);
    isStarred = true;
  } else {
    message.starredBy.splice(idx, 1);
    isStarred = false;
  }

  await message.save();

  const payload = {
    groupId: String(group._id),
    messageId: String(message._id),
    isStarred,
    userId: uIdStr,
  };

  emitToUser(me, GROUP_SOCKET_EVENTS.GROUP_MESSAGE_STARRED, payload);

  return payload;
};

export const markGroupSeenService = async ({
  group,
  member,
  me,
  readReceipts,
}) => {
  const blocked = await getBlockedByMe(me);

  const unread = await groupMessageRepository
    .find({
      groupId: group._id,
      createdAt: { $gte: member.joinedAt },
      senderId: { $nin: [...blocked, me] },
      readBy: { $ne: me },
      silentReadBy: { $ne: me },
    })
    .select("_id senderId");

  const ids = unread.map((m) => m._id);

  if (ids.length) {
    if (readReceipts !== false) {
      // Respect mutual privacy per message:
      // only record in readBy and broadcast if sender ALSO has read receipts enabled
      const visibleIds = [];
      const silentIds = [];

      for (const m of unread) {
        const sPriv = getPrivacy(String(m.senderId)) || {};
        if (sPriv.readReceipts !== false) {
          visibleIds.push(m._id);
        } else {
          silentIds.push(m._id);
        }
      }

      if (visibleIds.length) {
        await groupMessageRepository.updateMany(
          { _id: { $in: visibleIds } },
          { $addToSet: { readBy: me } },
        );
        emitToGroupRoom(group._id, GROUP_SOCKET_EVENTS.GROUP_MESSAGES_SEEN, {
          groupId: String(group._id),
          seenBy: String(me),
          messageIds: visibleIds,
        });
      }

      if (silentIds.length) {
        await groupMessageRepository.updateMany(
          { _id: { $in: silentIds } },
          { $addToSet: { silentReadBy: me } },
        );
      }
    } else {
      await groupMessageRepository.updateMany(
        { _id: { $in: ids } },
        { $addToSet: { silentReadBy: me } },
      );
    }
  }

  await emitMemberConversation(group._id, member);

  return { count: ids.length };
};

export const getGroupMessagesForRequest = async ({ groupId, me, query }) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  return getGroupMessagesList({ group, member, me, query });
};

export const sendGroupMessageForRequest = async ({
  groupId,
  me,
  body,
  file,
}) => {
  const { group } = await getGroupAndMember(groupId, me);
  return sendGroupMessageService({ group, me, body, file });
};

export const editGroupMessageForRequest = async ({
  groupId,
  me,
  messageId,
  body,
}) => {
  const { group } = await getGroupAndMember(groupId, me);
  return editGroupMessageService({ group, me, messageId, body });
};

export const deleteGroupMessageForRequest = async ({
  groupId,
  me,
  messageId,
}) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  return deleteGroupMessageService({ group, member, me, messageId });
};

export const deleteGroupMessageForMeForRequest = async ({
  groupId,
  me,
  messageId,
}) => {
  const { group } = await getGroupAndMember(groupId, me);
  return deleteGroupMessageForMeService({ group, me, messageId });
};

export const togglePinGroupMessageForRequest = async ({
  groupId,
  me,
  messageId,
}) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  return togglePinGroupMessageService({ group, member, me, messageId });
};

export const toggleStarGroupMessageForRequest = async ({
  groupId,
  me,
  messageId,
}) => {
  const { group } = await getGroupAndMember(groupId, me);
  return toggleStarGroupMessageService({ group, me, messageId });
};

export const markGroupSeenForRequest = async ({ groupId, me }) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  const privacy = getPrivacy(String(me)) || {};
  const readReceipts = privacy.readReceipts !== false;
  return markGroupSeenService({ group, member, me, readReceipts });
};

const groupMessageService = {
  getGroupMessagesList,
  getPinnedGroupMessagesList,
  sendGroupMessageService,
  editGroupMessageService,
  deleteGroupMessageService,
  deleteGroupMessageForMeService,
  togglePinGroupMessageService,
  toggleStarGroupMessageService,
  markGroupSeenService,
  getPinnedGroupMessagesForRequest,
  sendGroupMessageForRequest,
  editGroupMessageForRequest,
  deleteGroupMessageForRequest,
  deleteGroupMessageForMeForRequest,
  togglePinGroupMessageForRequest,
  toggleStarGroupMessageForRequest,
  markGroupSeenForRequest,
};

export default groupMessageService;
