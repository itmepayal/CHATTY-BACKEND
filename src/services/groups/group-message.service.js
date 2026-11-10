import fs from "fs/promises";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import * as groupMessageRepository from "../../repositories/groups/group-message.repository.js";
import * as contactRepository from "../../repositories/contact.repository.js";
import { readClientId } from "../../utils/validators.js";
import { parseBool, assertValidCipher } from "../../utils/e2ee.js";
import { canViewSync } from "../privacy/privacy-visibility.service.js";
import { getBlockedByMe, getGroupAndMember } from "../../utils/group-guard.js";
import { getPrivacy } from "../../lib/socket-state.js";
import { uploadAttachment } from "./group-media.service.js";
import {
  canDeleteMessage,
  canEditMessage,
} from "../../policies/group.policy.js";
import {
  broadcastGroupMessageEdited,
  broadcastGroupMessageDeleted,
  emitToGroupRoom,
} from "../../events/group.events.js";
import {
  EDIT_WINDOW_MS,
  GROUP_ERROR_MESSAGES,
} from "../../constants/group.constants.js";
import { GROUP_SOCKET_EVENTS } from "../../constants/group-events.constants.js";
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
      createdAt,
      senderId: { $nin: blocked },
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("senderId", "fullName avatar profilePhotoVisibility");

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

  return msgs.reverse().map((m) => {
    const formatted = formatGroupMessage(m);
    const sender = m.senderId;
    if (sender) {
      const sId = sid(sender);
      if (sId !== String(me)) {
        const vis = sender.profilePhotoVisibility ?? "everyone";
        const canSeePhoto = canViewSync(vis, sId, me, targetSavedMeSet);
        if (!canSeePhoto && formatted.sender) {
          formatted.sender.avatar = "";
        }
      }
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

    const message = await groupMessageRepository.create({
      groupId: group._id,
      senderId: me,
      text,
      ...attachment,
      ...cipher,
      clientId,
      readBy: [me],
    });

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
          isEdited: true,
          editedAt: new Date(),
        },
      },
      { new: true },
    )
    .populate("senderId", "fullName avatar profilePhotoVisibility");

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

  if (message.location?.shareId) {
    await endShare(
      group,
      { _id: message.location.shareId, messageId: message._id },
      "stopped",
    );
  }

  await groupMessageRepository.deleteOne({ _id: messageId });

  await Promise.allSettled(deleteMedia(message));

  const payload = {
    groupId: String(group._id),
    messageId: String(messageId),
  };

  broadcastGroupMessageDeleted(group, payload);
  await emitGroupConversation(group);

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
    .select("_id");

  const ids = unread.map((m) => m._id);

  if (ids.length) {
    if (readReceipts !== false) {
      await groupMessageRepository.updateMany(
        { _id: { $in: ids } },
        { $addToSet: { readBy: me } },
      );
      emitToGroupRoom(group._id, GROUP_SOCKET_EVENTS.GROUP_MESSAGES_SEEN, {
        groupId: String(group._id),
        seenBy: String(me),
        messageIds: ids,
      });
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

export const markGroupSeenForRequest = async ({ groupId, me }) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  const privacy = getPrivacy(String(me)) || {};
  const readReceipts = privacy.readReceipts !== false;
  return markGroupSeenService({ group, member, me, readReceipts });
};

const groupMessageService = {
  getGroupMessagesList,
  sendGroupMessageService,
  editGroupMessageService,
  deleteGroupMessageService,
  markGroupSeenService,
  sendGroupMessageForRequest,
  editGroupMessageForRequest,
  deleteGroupMessageForRequest,
  markGroupSeenForRequest,
};

export default groupMessageService;
