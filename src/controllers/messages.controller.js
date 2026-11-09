import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import mongoose from "mongoose";
import fs from "fs";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import * as chatSettingService from "../services/messaging/chat-setting.service.js";
import * as reportService from "../services/messaging/message-report.service.js";
import * as scheduleService from "../services/messaging/message-schedule.service.js";
import * as locationService from "../services/messaging/message-location.service.js";
import * as queryService from "../services/messaging/message-query.service.js";
import User from "../models/users.model.js";
import Message from "../models/message.model.js";
import ScheduledMessage from "../models/scheduled-message.model.js";
import Report from "../models/report.model.js";
import ChatSetting, {
  ALLOWED_TIMERS,
  pairKeyOf,
  getDisappearAfter,
} from "../models/chat-setting.model.js";
import ChatArchive, { getArchivedSet } from "../models/chat-archive.model.js";
import LocationShare from "../models/location-share.model.js";
import ApiResponse from "../utils/api-response.js";
import { io, getPrivacy } from "../lib/socket.js";
import { assertCanMessage } from "../utils/chat-guard.js";
import {
  deliverMessage,
  assertE2EEReady,
  assertNotSpamming,
  processAttachment,
} from "../services/message.service.js";
import { attachLinkPreview } from "../utils/link-preview.js";
import {
  wipeMessage,
  deleteAttachmentMedia,
} from "../utils/message-cleanup.js";
import {
  toObjectId,
  formatMessage,
  emitConversationUpdate,
  isParticipantOf,
  getOtherUserId,
  isBetween,
  REPLY_SELECT,
  emitToPair,
  notExpired,
  isExpired,
} from "../utils/message-helpers.js";
import {
  MAX_CIPHERTEXT_LENGTH,
  parseBool,
  assertValidCipher,
} from "../utils/e2ee.js";
import {
  assertValidId,
  toNum,
  validCoords,
  escapeRegex,
} from "../utils/validators.js";
import {
  EDIT_WINDOW_MS,
  MAX_PINS,
  MAX_FORWARD_TARGETS,
  MAX_TEXT_LENGTH,
  REPORT_REASONS,
  LIVE_DURATIONS_MIN,
} from "../constants/constants.js";
import { canViewSync } from "../services/privacy-visibility.service.js";
import { isBlockedEitherWay } from "../services/privacy/privacy.service.js";
import Contact from "../models/contact.model.js";

const messageController = {
  getUsersForSidebar: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    assertValidId(userId, "User ID");

    const uid = toObjectId(userId);
    const search = String(req.query.search || req.query.q || "").trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 100);

    // 1. Fetch current user blocked list and archived set
    const [me, archivedSet] = await Promise.all([
      User.findById(userId).select("blockedUsers").lean(),
      getArchivedSet(userId),
    ]);

    const myBlockedSet = new Set((me?.blockedUsers || []).map(String));

    // 2. Primary Source: Existing active conversations
    const convoAgg = await Message.aggregate([
      {
        $match: {
          $and: [
            { $or: [{ senderId: uid }, { receiverId: uid }] },
            notExpired(),
          ],
          deletedFor: { $ne: uid },
        },
      },
      {
        $addFields: {
          otherId: {
            $cond: [{ $eq: ["$senderId", uid] }, "$receiverId", "$senderId"],
          },
          isUnread: {
            $and: [
              { $eq: ["$receiverId", uid] },
              { $ne: ["$status", "seen"] },
              { $eq: [{ $ifNull: ["$receiverReadAt", null] }, null] },
              { $ne: ["$isDeleted", true] },
            ],
          },
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$otherId",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: { $sum: { $cond: ["$isUnread", 1, 0] } },
        },
      },
    ]);

    const convoMap = new Map(convoAgg.map((c) => [c._id.toString(), c]));
    const convoUserIds = convoAgg.map((c) => c._id.toString());

    let targetUserIds = [];

    if (search) {
      // 5. Database-level filtering for search
      const rx = new RegExp(escapeRegex(search), "i");
      const matchedUsers = await User.find({
        _id: { $ne: userId, $nin: [...myBlockedSet] },
        blockedUsers: { $ne: userId },
        $or: [{ fullName: rx }, { username: rx }, { email: rx }],
      })
        .select("_id")
        .limit(limit)
        .lean();

      targetUserIds = matchedUsers.map((u) => u._id.toString());
    } else {
      // 3. Existing conversations as primary source + 4. Saved contacts
      const contacts = await Contact.find({ ownerId: userId })
        .select("contactId")
        .lean();
      const contactUserIds = contacts.map((c) => c.contactId.toString());

      const combinedSet = new Set([...convoUserIds, ...contactUserIds]);

      // If user has neither conversations nor contacts, fetch a bounded set of discoverable users
      if (combinedSet.size === 0) {
        const discoverUsers = await User.find({
          _id: { $ne: userId, $nin: [...myBlockedSet] },
          blockedUsers: { $ne: userId },
        })
          .select("_id")
          .limit(limit)
          .lean();
        discoverUsers.forEach((u) => combinedSet.add(u._id.toString()));
      }

      // Paginate target IDs before querying full user documents
      const allTargetIds = Array.from(combinedSet);
      const skip = (page - 1) * limit;
      targetUserIds = allTargetIds.slice(skip, skip + limit);
    }

    if (!targetUserIds.length) {
      return new ApiResponse(
        StatusCodes.OK,
        [],
        "Users fetched successfully.",
      ).send(res);
    }

    // 6. Query ONLY the target subset (at most `limit`, e.g. 50 users instead of 10,000!)
    const [users, blockers, contactsWhoSavedMe] = await Promise.all([
      User.find({ _id: { $in: targetUserIds } })
        .select(
          "fullName email avatar bio lastSeen showOnlineStatus onlineStatusVisibility lastSeenVisibility profilePhotoVisibility aboutVisibility +publicKey",
        )
        .lean(),
      User.find({ _id: { $in: targetUserIds }, blockedUsers: userId })
        .select("_id")
        .lean(),
      Contact.find({ ownerId: { $in: targetUserIds }, contactId: userId })
        .select("ownerId")
        .lean(),
    ]);

    const blockerSet = new Set(blockers.map((b) => String(b._id)));
    const targetSavedMeSet = new Set(
      contactsWhoSavedMe.map((c) => String(c.ownerId)),
    );

    const ts = Date.now();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const response = targetUserIds
      .map((otherId) => {
        const user = userMap.get(otherId);
        if (!user) return null;

        const c = convoMap.get(otherId);
        const isBlockedByMe = myBlockedSet.has(otherId);
        const isBlockedEither = isBlockedByMe || blockerSet.has(otherId);

        const canSee = (visibility, fallback) =>
          !isBlockedEither &&
          canViewSync(
            visibility ?? fallback,
            otherId,
            userId,
            targetSavedMeSet,
          );

        const showPhoto = canSee(user.profilePhotoVisibility, "everyone");
        const showLastSeen = canSee(user.lastSeenVisibility, "contacts");
        const showAbout = canSee(user.aboutVisibility, "contacts");
        const onlineVis =
          user.showOnlineStatus === false
            ? "nobody"
            : (user.onlineStatusVisibility ?? "everyone");
        const showOnline = canSee(onlineVis, "everyone");

        return {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          avatar: showPhoto ? user.avatar?.url || "" : "",
          bio: showAbout ? user.bio || "" : "",
          lastSeen: showLastSeen ? user.lastSeen || null : null,
          showOnlineStatus: showOnline,
          isBlocked: isBlockedByMe,
          isArchived: archivedSet.has(otherId),
          hasPublicKey: Boolean(user.publicKey),
          unreadCount: isBlockedEither ? 0 : c?.unreadCount || 0,
          lastMessage: c ? formatMessage(c.lastMessage) : null,
          lastMessageAt: c?.lastMessage?.createdAt || null,
          ts,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bt - at;
      });

    return new ApiResponse(
      StatusCodes.OK,
      response,
      "Users fetched successfully.",
    ).send(res);
  }),

  getMessage: asyncHandler(async (req, res) => {
    const { messages, message } = await queryService.getMessages(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, messages, message).send(res);
  }),

  sendMessage: asyncHandler(async (req, res) => {
    const {
      text,
      clientId,
      isVoice,
      isVideo,
      duration,
      iv,
      replyTo: replyToId,
    } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    assertValidId(receiverId, "receiver ID");

    if (receiverId.toString() === senderId.toString()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You cannot send a message to yourself.",
      );
    }

    const trimmedText = text?.trim();

    if (!trimmedText && !req.file) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
    }

    const isEncryptedReq = parseBool(req.body.encrypted ?? req.body.e2ee);

    // E2EE Media Guard: Media attachments are not client-side encrypted yet.
    if (isEncryptedReq && req.file) {
      if (req.file.path) fs.unlink(req.file.path, () => {});
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "End-to-end encrypted media is not supported. Please send media in standard mode or send text only.",
      );
    }

    const wantsE2EE = isEncryptedReq && Boolean(trimmedText);
    const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;

    if (trimmedText && trimmedText.length > maxLen) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        wantsE2EE
          ? "Message is too long."
          : `Message is too long (max ${MAX_TEXT_LENGTH} characters).`,
      );
    }
    if (wantsE2EE) {
      assertValidCipher(trimmedText, iv);
    }

    if (clientId) {
      const existing = await Message.findOne({ senderId, clientId });
      if (existing) {
        return new ApiResponse(
          StatusCodes.OK,
          formatMessage(existing),
          "Message already sent.",
        ).send(res);
      }
    }

    await assertCanMessage(senderId, receiverId);
    if (wantsE2EE) await assertE2EEReady(senderId, receiverId);
    await assertNotSpamming(
      senderId,
      receiverId,
      wantsE2EE ? undefined : trimmedText,
    );

    let replyTo;
    if (replyToId) {
      assertValidId(replyToId, "reply ID");
      const original = await Message.findById(replyToId).select(
        "senderId receiverId isDeleted",
      );
      if (
        !original ||
        original.isDeleted ||
        !isBetween(original, senderId, receiverId)
      ) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Cannot reply to this message.",
        );
      }
      replyTo = original._id;
    }

    const attachment = await processAttachment(req.file, {
      isVoice: parseBool(isVoice),
      isVideo: parseBool(isVideo),
      duration,
    });
    const {
      image: uploadedImage,
      file: uploadedFile,
      audio: uploadedAudio,
      video: uploadedVideo,
    } = attachment;

    let result;
    try {
      result = await deliverMessage({
        senderId,
        receiverId,
        data: {
          text: trimmedText,
          clientId: clientId || undefined,
          image: uploadedImage || undefined,
          file: uploadedFile || undefined,
          audio: uploadedAudio || undefined,
          video: uploadedVideo || undefined,
          replyTo,
          ...(wantsE2EE ? { e2ee: true, iv } : {}),
        },
      });
    } catch (error) {
      await deleteAttachmentMedia(attachment);

      if (error?.code === 11000 && clientId) {
        const existing = await Message.findOne({ senderId, clientId });
        if (existing) {
          return new ApiResponse(
            StatusCodes.OK,
            formatMessage(existing),
            "Message already sent.",
          ).send(res);
        }
      }
      throw error;
    }

    const { message, payload } = result;

    if (!wantsE2EE) attachLinkPreview(message);

    return new ApiResponse(
      StatusCodes.CREATED,
      payload,
      "Message sent successfully.",
    ).send(res);
  }),

  forwardMessage: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    assertValidId(messageId, "message ID");

    const userIds = [...new Set((req.body.userIds || []).map(String))].filter(
      (id) => id !== userId.toString(),
    );

    if (!userIds.length || userIds.length > MAX_FORWARD_TARGETS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Choose 1 to ${MAX_FORWARD_TARGETS} recipients.`,
      );
    }
    userIds.forEach((id) => assertValidId(id, "recipient ID"));

    const original = await Message.findById(messageId);
    if (
      !original ||
      original.isDeleted ||
      isExpired(original) ||
      !isParticipantOf(original, userId)
    ) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You cannot forward this message.",
      );
    }

    const o = original.toObject();
    const isEncrypted = Boolean(o.e2ee) && Boolean(o.text);
    const encryptedFor =
      req.body.encrypted && typeof req.body.encrypted === "object"
        ? req.body.encrypted
        : {};

    const content = {
      text: isEncrypted ? undefined : o.text,
      image: o.image?.url ? o.image : undefined,
      file: o.file?.url ? o.file : undefined,
      audio: o.audio?.url ? o.audio : undefined,
      video: o.video?.url ? o.video : undefined,
      location:
        Number.isFinite(o.location?.lat) && Number.isFinite(o.location?.lng)
          ? {
              lat: o.location.lat,
              lng: o.location.lng,
              accuracy: o.location.accuracy,
              isLive: false,
            }
          : undefined,
      linkPreview: o.linkPreview?.url ? o.linkPreview : undefined,
      isForwarded: true,
    };

    const sent = [];
    const failed = [];
    for (const receiverId of userIds) {
      try {
        await assertCanMessage(userId, receiverId);

        const data = { ...content };
        if (isEncrypted) {
          const enc = encryptedFor[receiverId];
          assertValidCipher(enc?.text, enc?.iv);
          await assertE2EEReady(userId, receiverId);
          data.text = enc.text;
          data.e2ee = true;
          data.iv = enc.iv;
        }

        const { payload } = await deliverMessage({
          senderId: userId,
          receiverId,
          data,
        });
        sent.push(payload);
      } catch (e) {
        failed.push(receiverId);
        console.error("forward failed for", receiverId, e?.message || e);
      }
    }

    return new ApiResponse(
      StatusCodes.OK,
      sent,
      failed.length
        ? `Forwarded to ${sent.length} chat(s). ${failed.length} failed.`
        : `Forwarded to ${sent.length} chat(s).`,
    ).send(res);
  }),

  editMessage: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;
    const text = req.body.text?.trim();
    const wantsE2EE = parseBool(req.body.encrypted ?? req.body.e2ee);
    const iv = req.body.iv;

    assertValidId(messageId, "message ID");

    const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;
    if (!text || text.length > maxLen) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        wantsE2EE
          ? "Encrypted payload is invalid or too large."
          : `Text must be 1-${MAX_TEXT_LENGTH} characters.`,
      );
    }

    const message = await Message.findById(messageId);
    if (!message || message.isDeleted || isExpired(message)) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }
    if (message.senderId.toString() !== userId.toString()) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Only the sender can edit.");
    }
    if (message.audio?.url || message.video?.url) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Voice/video messages can't be edited.",
      );
    }
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Edit time is over.");
    }

    if (Boolean(message.e2ee) !== wantsE2EE) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Encryption mode of a message can't be changed.",
      );
    }
    if (wantsE2EE) assertValidCipher(text, iv);

    await assertCanMessage(userId, message.receiverId);
    if (wantsE2EE) await assertE2EEReady(userId, message.receiverId);

    if (!wantsE2EE && message.text === text) {
      return new ApiResponse(
        StatusCodes.OK,
        { messageId: message._id },
        "No changes.",
      ).send(res);
    }

    message.text = text;
    if (wantsE2EE) message.iv = iv;
    message.isEdited = true;
    message.editedAt = new Date();
    message.linkPreview = undefined;
    await message.save();

    const payload = {
      messageId: message._id,
      text,
      isEdited: true,
      editedAt: message.editedAt,
      ...(wantsE2EE ? { encrypted: true, iv } : {}),
    };

    emitToPair(message.receiverId, message.senderId, "messageEdited", payload);

    await Promise.all([
      emitConversationUpdate(message.receiverId, message.senderId),
      emitConversationUpdate(message.senderId, message.receiverId),
    ]);

    if (!wantsE2EE) attachLinkPreview(message);

    return new ApiResponse(StatusCodes.OK, payload, "Message edited.").send(
      res,
    );
  }),

  togglePin: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    assertValidId(messageId, "message ID");

    const message = await Message.findById(messageId);
    if (!message || message.isDeleted || isExpired(message)) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }
    if (!isParticipantOf(message, userId)) {
      throw new ApiError(StatusCodes.FORBIDDEN, "You cannot pin this message.");
    }

    const otherId = getOtherUserId(message, userId);
    await assertCanMessage(userId, otherId);

    if (!message.isPinned) {
      const count = await Message.countDocuments({
        isPinned: true,
        isDeleted: { $ne: true },
        deletedFor: { $ne: userId },
        $or: [
          { senderId: userId, receiverId: otherId },
          { senderId: otherId, receiverId: userId },
        ],
      });
      if (count >= MAX_PINS) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `You can pin up to ${MAX_PINS} messages.`,
        );
      }
      message.isPinned = true;
      message.pinnedBy = userId;
      message.pinnedAt = new Date();
    } else {
      message.isPinned = false;
      message.pinnedBy = undefined;
      message.pinnedAt = undefined;
    }

    await message.save();

    const payload = {
      messageId: message._id,
      isPinned: message.isPinned,
      pinnedBy: userId,
    };

    emitToPair(userId, otherId, "messagePinned", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Pin updated.").send(res);
  }),

  getPinned: asyncHandler(async (req, res) => {
    const { pinned, message } = await queryService.getPinned(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, pinned, message).send(res);
  }),

  searchMessages: asyncHandler(async (req, res) => {
    const { results, message } = await queryService.searchMessages(
      req.user._id,
      req.params.id,
      req.query,
    );
    return new ApiResponse(StatusCodes.OK, results, message).send(res);
  }),

  scheduleMessage: asyncHandler(async (req, res) => {
    const { doc, message } = await scheduleService.scheduleMessage(
      req.user._id,
      req.params.id,
      req.body,
    );
    return new ApiResponse(StatusCodes.CREATED, doc, message).send(res);
  }),

  getScheduled: asyncHandler(async (req, res) => {
    const { list, message } = await scheduleService.getScheduled(
      req.user._id,
      req.query,
    );
    return new ApiResponse(StatusCodes.OK, list, message).send(res);
  }),

  cancelScheduled: asyncHandler(async (req, res) => {
    const { id, message } = await scheduleService.cancelScheduled(
      req.user._id,
      req.params.scheduleId,
    );
    return new ApiResponse(StatusCodes.OK, { id }, message).send(res);
  }),

  markMessagesSeen: asyncHandler(async (req, res) => {
    const { id: otherUserId } = req.params;
    const userId = req.user._id;

    assertValidId(otherUserId, "user ID");

    const blocked = await isBlockedEitherWay(userId, otherUserId);
    const canReceipt =
      !blocked &&
      getPrivacy(userId).readReceipts !== false &&
      getPrivacy(otherUserId).readReceipts !== false;

    const unseen = await Message.find({
      senderId: otherUserId,
      receiverId: userId,
      status: { $ne: "seen" },
      receiverReadAt: null,
      isDeleted: { $ne: true },
    }).select("_id");

    const ids = unseen.map((m) => m._id);

    if (ids.length) {
      const now = new Date();

      if (canReceipt) {
        await Message.updateMany({ _id: { $in: ids } }, [
          {
            $set: {
              status: "seen",
              seenAt: now,
              receiverReadAt: now,
              deliveredAt: { $ifNull: ["$deliveredAt", now] },
            },
          },
        ]);

        io.to(otherUserId.toString()).emit("messagesSeen", {
          messageIds: ids,
          seenBy: userId,
          seenAt: now,
        });
      } else {
        await Message.updateMany(
          { _id: { $in: ids } },
          { $set: { receiverReadAt: now } },
        );
      }
    }

    await emitConversationUpdate(userId, otherUserId);

    return new ApiResponse(
      StatusCodes.OK,
      { count: ids.length },
      "Messages marked as seen.",
    ).send(res);
  }),

  reactMessage: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    assertValidId(messageId, "message ID");

    if (!emoji || typeof emoji !== "string" || emoji.length > 16) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Valid emoji is required.");
    }

    const message = await Message.findById(messageId);

    if (!message) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }
    if (message.isDeleted || isExpired(message)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Cannot react to a deleted message.",
      );
    }
    if (!isParticipantOf(message, userId)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You cannot react to this message.",
      );
    }

    await assertCanMessage(userId, getOtherUserId(message, userId));

    const existingIndex = message.reactions.findIndex(
      (r) => r.userId.toString() === userId.toString(),
    );

    if (existingIndex === -1) {
      message.reactions.push({ userId, emoji });
    } else if (message.reactions[existingIndex].emoji === emoji) {
      message.reactions.splice(existingIndex, 1);
    } else {
      message.reactions[existingIndex].emoji = emoji;
    }

    await message.save();

    const payload = {
      messageId: message._id,
      reactions: message.reactions.map((r) => ({
        userId: r.userId,
        emoji: r.emoji,
      })),
    };

    const otherUserId = getOtherUserId(message, userId);

    emitToPair(otherUserId, userId, "messageReaction", payload);

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      "Reaction updated successfully.",
    ).send(res);
  }),

  deleteMessageForMe: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    assertValidId(messageId, "message ID");

    const message = await Message.findById(messageId);

    if (!message) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }
    if (!isParticipantOf(message, userId)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You cannot delete this message.",
      );
    }

    await Message.updateOne(
      { _id: messageId },
      { $addToSet: { deletedFor: userId } },
    );

    io.to(userId.toString()).emit("messageDeletedForMe", {
      messageId: message._id,
    });

    await emitConversationUpdate(userId, getOtherUserId(message, userId));

    return new ApiResponse(
      StatusCodes.OK,
      { messageId: message._id },
      "Message deleted for you.",
    ).send(res);
  }),

  deleteMessageForEveryone: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;

    assertValidId(messageId, "message ID");

    const message = await Message.findById(messageId);

    if (!message) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }
    if (message.senderId.toString() !== userId.toString()) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Only the sender can delete a message for everyone.",
      );
    }
    if (message.isDeleted) {
      return new ApiResponse(
        StatusCodes.OK,
        { messageId: message._id },
        "Message already deleted.",
      ).send(res);
    }

    await wipeMessage(message);

    const payload = { messageId: message._id };

    emitToPair(message.receiverId, message.senderId, "messageDeleted", payload);

    await Promise.all([
      emitConversationUpdate(message.receiverId, message.senderId),
      emitConversationUpdate(message.senderId, message.receiverId),
    ]);

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      "Message deleted for everyone.",
    ).send(res);
  }),

  reportUser: asyncHandler(async (req, res) => {
    const { message } = await reportService.reportUser(
      req.user._id,
      req.params.id,
      req.body,
    );
    return new ApiResponse(StatusCodes.CREATED, null, message).send(res);
  }),

  getDisappearing: asyncHandler(async (req, res) => {
    const { seconds } = await chatSettingService.getDisappearing(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(
      StatusCodes.OK,
      { seconds },
      "Disappearing setting.",
    ).send(res);
  }),

  setDisappearing: asyncHandler(async (req, res) => {
    const { seconds, message } = await chatSettingService.setDisappearing(
      req.user._id,
      req.params.id,
      req.body.seconds,
    );
    return new ApiResponse(StatusCodes.OK, { seconds }, message).send(res);
  }),

  setArchive: asyncHandler(async (req, res) => {
    const { userId, archived, message } = await chatSettingService.setArchive(
      req.user._id,
      req.params.id,
      req.body.archived,
    );
    return new ApiResponse(
      StatusCodes.OK,
      { userId, archived },
      message,
    ).send(res);
  }),

  startShare: asyncHandler(async (req, res) => {
    const { status, data, message } = await locationService.startShare(
      req.user._id,
      req.body,
    );
    return new ApiResponse(status, data, message).send(res);
  }),

  stopShare: asyncHandler(async (req, res) => {
    const { shareId, message } = await locationService.stopShare(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, { shareId }, message).send(res);
  }),

  getActiveShares: asyncHandler(async (req, res) => {
    const { mine, forMe, message } = await locationService.getActiveShares(
      req.user._id,
    );
    return new ApiResponse(StatusCodes.OK, { mine, forMe }, message).send(res);
  }),
};

export default messageController;
