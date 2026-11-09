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
import * as lifecycleService from "../services/messaging/message-lifecycle.service.js";
import * as forwardService from "../services/messaging/message-forward.service.js";
import * as deliveryService from "../services/messaging/message-delivery.service.js";
import * as sendService from "../services/messaging/message-send.service.js";
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

    const [me, archivedSet] = await Promise.all([
      User.findById(userId).select("blockedUsers").lean(),
      getArchivedSet(userId),
    ]);

    const myBlockedSet = new Set((me?.blockedUsers || []).map(String));

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
      const contacts = await Contact.find({ ownerId: userId })
        .select("contactId")
        .lean();
      const contactUserIds = contacts.map((c) => c.contactId.toString());

      const combinedSet = new Set([...convoUserIds, ...contactUserIds]);

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
    const { status, payload, message } = await sendService.sendMessage(
      req.user._id,
      req.params.id,
      req.body,
      req.file,
    );
    return new ApiResponse(status, payload, message).send(res);
  }),

  forwardMessage: asyncHandler(async (req, res) => {
    const { sent, message } = await forwardService.forwardMessage(
      req.user._id,
      req.params.messageId,
      req.body,
    );
    return new ApiResponse(StatusCodes.OK, sent, message).send(res);
  }),

  editMessage: asyncHandler(async (req, res) => {
    const { payload, message } = await lifecycleService.editMessage(
      req.user._id,
      req.params.messageId,
      req.body,
    );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
  }),

  togglePin: asyncHandler(async (req, res) => {
    const { payload, message } = await lifecycleService.togglePin(
      req.user._id,
      req.params.messageId,
    );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
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
    const { count, message } = await deliveryService.markMessagesSeen(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, { count }, message).send(res);
  }),

  reactMessage: asyncHandler(async (req, res) => {
    const { payload, message } = await lifecycleService.reactMessage(
      req.user._id,
      req.params.messageId,
      req.body.emoji,
    );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
  }),

  deleteMessageForMe: asyncHandler(async (req, res) => {
    const { messageId, message } = await lifecycleService.deleteMessageForMe(
      req.user._id,
      req.params.messageId,
    );
    return new ApiResponse(StatusCodes.OK, { messageId }, message).send(res);
  }),

  deleteMessageForEveryone: asyncHandler(async (req, res) => {
    const { payload, message } =
      await lifecycleService.deleteMessageForEveryone(
        req.user._id,
        req.params.messageId,
      );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
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
    return new ApiResponse(StatusCodes.OK, { userId, archived }, message).send(
      res,
    );
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
