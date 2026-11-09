import fs from "fs/promises";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import GroupMessage from "../models/group-message.model.js";
import LocationShare from "../models/location-share.model.js";
import Contact from "../models/contact.model.js";
import { readClientId } from "../utils/validators.js";
import { parseBool, assertValidCipher } from "../utils/e2ee.js";
import { canViewSync } from "./privacy-visibility.service.js";
import { getBlockedByMe } from "../utils/group-guard.js";
import { uploadAttachment } from "./group-media.service.js";
import {
  canDeleteMessage,
  canEditMessage,
} from "../policies/group.policy.js";
import {
  broadcastGroupMessageEdited,
  broadcastGroupMessageDeleted,
  emitToGroupRoom,
} from "../events/group.events.js";
import {
  EDIT_WINDOW_MS,
  MAX_CIPHERTEXT_LENGTH,
  MAX_GROUP_TEXT,
  GROUP_ERROR_MESSAGES,
} from "../constants/group.constants.js";
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
} from "./group.service.js";

/**
 * Safely unlinks a temporary file without throwing.
 * @param {string} filePath
 */
export const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (_err) {
    // Ignore ENOENT / storage cleanup errors
  }
};

/**
 * Determines whether a group message contains text only.
 * Checks lat != null to avoid treating lat: 0 as false.
 * @param {Object} message
 * @returns {boolean}
 */
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

/**
 * Fetches group messages with cursor pagination and privacy filtering.
 * @param {Object} params
 * @param {Object} params.group
 * @param {Object} params.member
 * @param {string|Object} params.me
 * @param {Object} params.query
 * @returns {Promise<Object[]>}
 */
export const getGroupMessagesList = async ({ group, member, me, query }) => {
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
    .populate("senderId", "fullName avatar profilePhotoVisibility");

  const senderIds = [
    ...new Set(msgs.map((m) => m.senderId?._id || m.senderId).filter(Boolean)),
  ];

  const contactsWhoSavedMe = await Contact.find({
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

/**
 * Sends a group message, preventing duplicate upload on duplicate clientId.
 * @param {Object} params
 * @param {Object} params.group
 * @param {string|Object} params.me
 * @param {Object} params.body
 * @param {Object} [params.file]
 * @returns {Promise<Object>}
 */
export const sendGroupMessageService = async ({ group, me, body, file }) => {
  const { text, cipher, isVoice, isVideo } = await validateGroupMessageInput(
    group,
    me,
    body,
    file,
  );

  const clientId = readClientId(body);

  if (clientId) {
    const dup = await findGroupMessageDuplicate(group._id, me, clientId);
    if (dup) {
      return { isDuplicate: true, payload: formatGroupMessage(dup) };
    }
  }

  let attachment = {};
  try {
    if (file?.path) {
      attachment = await uploadAttachment(file, {
        isVoice,
        isVideo,
        duration: body.duration,
      });
    }

    const message = await GroupMessage.create({
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

/**
 * Edits a group message atomically using findOneAndUpdate to prevent race conditions.
 * @param {Object} params
 * @param {Object} params.group
 * @param {string|Object} params.me
 * @param {string} params.messageId
 * @param {Object} params.body
 * @returns {Promise<Object>}
 */
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

  // Never trim ciphertext; trim only plain text
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

  // Atomic update query
  const updatedMessage = await GroupMessage.findOneAndUpdate(
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
  ).populate("senderId", "fullName avatar profilePhotoVisibility");

  if (!updatedMessage) {
    // Diagnostic query to return the exact descriptive error
    const msg = await GroupMessage.findOne({
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
  }

  const payload = formatGroupMessage(updatedMessage);
  broadcastGroupMessageEdited(group, payload);
  await emitGroupConversation(group);

  return { payload };
};

/**
 * Deletes a group message: validates ownership/admin rights, deactivates active live shares,
 * deletes the database record FIRST, then cleans up Cloudinary media.
 * @param {Object} params
 * @param {Object} params.group
 * @param {Object} params.member
 * @param {string|Object} params.me
 * @param {string} params.messageId
 * @returns {Promise<Object>}
 */
export const deleteGroupMessageService = async ({
  group,
  member,
  me,
  messageId,
}) => {
  const message = await GroupMessage.findById(messageId);
  if (!message || String(message.groupId) !== String(group._id)) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.MESSAGE_NOT_FOUND,
    );
  }

  canDeleteMessage({ group, member, message, actorId: me });

  // Deactivate active LocationShare if deleted message was a live location
  if (message.location?.shareId) {
    await LocationShare.updateOne(
      { _id: message.location.shareId },
      { $set: { status: "stopped", endedAt: new Date() } },
    );
  }

  // DB delete first
  await GroupMessage.deleteOne({ _id: messageId });

  // Clean Cloudinary media after DB deletion succeeds
  await Promise.allSettled(deleteMedia(message));

  const payload = {
    groupId: String(group._id),
    messageId: String(messageId),
  };

  broadcastGroupMessageDeleted(group, payload);
  await emitGroupConversation(group);

  return payload;
};

/**
 * Marks group messages as seen with fallback privacy lookup.
 * @param {Object} params
 * @param {Object} params.group
 * @param {Object} params.member
 * @param {string|Object} params.me
 * @param {boolean} params.readReceipts
 * @returns {Promise<{ count: number }>}
 */
export const markGroupSeenService = async ({
  group,
  member,
  me,
  readReceipts,
}) => {
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
    if (readReceipts !== false) {
      await GroupMessage.updateMany(
        { _id: { $in: ids } },
        { $addToSet: { readBy: me } },
      );
      emitToGroupRoom(group._id, GROUP_SOCKET_EVENTS.GROUP_MESSAGES_SEEN, {
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
