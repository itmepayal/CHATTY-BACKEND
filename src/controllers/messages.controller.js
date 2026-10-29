import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import mongoose from "mongoose";
import ApiError from "../utils/apiError.js";
import { StatusCodes } from "http-status-codes";
import User from "../models/users.model.js";
import Message from "../models/message.model.js";
import ScheduledMessage from "../models/scheduledMessage.model.js";
import Report from "../models/report.model.js";
import ChatSetting, {
  ALLOWED_TIMERS,
  pairKeyOf,
  getDisappearAfter,
} from "../models/chatSetting.model.js";
import ChatArchive, { getArchivedSet } from "../models/chatArchive.model.js";
import LocationShare from "../models/LocationShare.model.js";
import ApiResponse from "../utils/apiResponse.js";
import { uploadFileToCloudinary } from "../config/cloudinary.config.js";
import { io, getPrivacy } from "../lib/socket.js";
import { assertCanMessage } from "../utils/chatguard.js";
import { deliverMessage } from "../services/message.service.js";
import { attachLinkPreview } from "../utils/linkPreview.js";
import { wipeMessage } from "../utils/messageCleanup.js";
import {
  toObjectId,
  formatMessage,
  emitConversationUpdate,
  isParticipantOf,
  getOtherUserId,
  isBetween,
  REPLY_SELECT,
} from "../utils/messageHelpers.js";
/* ---------------- E2EE ---------------- */
import {
  MAX_CIPHERTEXT_LENGTH,
  parseBool,
  assertValidCipher,
} from "../utils/e2ee.js";

const MAX_VOICE_SECONDS = 300;
const MAX_VIDEO_SECONDS = 60;
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_PINS = 3;
const MAX_FORWARD_TARGETS = 5;
const MAX_TEXT_LENGTH = 4000;

/* ---------------- LOCATION HELPERS ---------------- */
const LIVE_DURATIONS_MIN = [15, 60, 480];

const toNum = (v) =>
  v === null || v === undefined || v === "" ? NaN : Number(v);

const validCoords = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

const emitToPair = (a, b, event, payload) => {
  io.to(a.toString()).emit(event, payload);
  io.to(b.toString()).emit(event, payload);
};

const REPORT_REASONS = [
  "spam",
  "harassment",
  "inappropriate",
  "impersonation",
  "other",
];

const SPAM = {
  DUP_WINDOW_MS: 30_000,
  DUP_MAX: 3,
  NEW_CHAT_WINDOW_MS: 60_000,
  NEW_CHAT_MAX: 10,
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const assertValidId = (id, label = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${label}.`);
  }
};

/* expiresAt null / missing = kabhi expire nahi hoga */
const notExpired = () => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});

const isExpired = (message) =>
  Boolean(message?.expiresAt) && message.expiresAt.getTime() <= Date.now();

/* ---------------- E2EE HELPERS ---------------- */
// dono users ne apni public key upload ki hui honi chahiye
const assertE2EEReady = async (senderId, receiverId) => {
  const users = await User.find({
    _id: { $in: [senderId, receiverId] },
  }).select("+publicKey");

  const hasKey = (id) =>
    users.some((u) => String(u._id) === String(id) && Boolean(u.publicKey));

  if (!hasKey(senderId)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Set up encryption on your device first.",
    );
  }
  if (!hasKey(receiverId)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "This user hasn't enabled encryption yet.",
    );
  }
};

/* ---------------- SPAM GUARD ---------------- */
// NOTE: encrypted text pe duplicate check nahi chalta (har ciphertext unique hota hai),
// isliye E2EE messages ke liye `text` undefined pass hota hai.
const assertNotSpamming = async (senderId, receiverId, text) => {
  // 1) same text baar-baar
  if (text) {
    const dup = await Message.countDocuments({
      senderId,
      receiverId,
      text,
      createdAt: { $gt: new Date(Date.now() - SPAM.DUP_WINDOW_MS) },
    });
    if (dup >= SPAM.DUP_MAX) {
      throw new ApiError(
        StatusCodes.TOO_MANY_REQUESTS,
        "Duplicate messages blocked. Please wait a bit.",
      );
    }
  }

  // 2) bahut saare alag-alag logon ko ek saath message (bot jaisa behaviour)
  const recentReceivers = await Message.distinct("receiverId", {
    senderId,
    createdAt: { $gt: new Date(Date.now() - SPAM.NEW_CHAT_WINDOW_MS) },
  });
  const alreadyTalking = recentReceivers.some(
    (id) => id.toString() === receiverId.toString(),
  );
  if (!alreadyTalking && recentReceivers.length >= SPAM.NEW_CHAT_MAX) {
    throw new ApiError(
      StatusCodes.TOO_MANY_REQUESTS,
      "You are messaging too many people too quickly.",
    );
  }
};

const processAttachment = async (
  file,
  { isVoice = false, isVideo = false, duration } = {},
) => {
  if (!file?.path) {
    return { image: null, file: null, audio: null, video: null };
  }

  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload attachment.");
  }

  if (file.mimetype?.startsWith("image/")) {
    return {
      image: { url: up.secure_url, public_id: up.public_id },
      file: null,
      audio: null,
      video: null,
    };
  }

  if (isVoice && file.mimetype?.startsWith("audio/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      image: null,
      file: null,
      video: null,
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
      image: null,
      file: null,
      audio: null,
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
    image: null,
    audio: null,
    video: null,
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

const messageController = {
  /* ---------------- SIDEBAR ---------------- */
  getUsersForSidebar: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    assertValidId(userId, "User ID");

    const uid = toObjectId(userId);

    const [users, me, archivedSet] = await Promise.all([
      // +publicKey sirf `hasPublicKey` nikalne ke liye, key response me nahi jaati
      User.find({ _id: { $ne: userId } }).select(
        "fullName email avatar +publicKey",
      ),
      User.findById(userId).select("blockedUsers"),
      getArchivedSet(userId),
    ]);

    const blockedSet = new Set((me?.blockedUsers || []).map(String));

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
    const ts = Date.now();

    const response = users
      .map((user) => {
        const c = convoMap.get(user._id.toString());
        const isBlocked = blockedSet.has(user._id.toString());
        return {
          id: user._id,
          fullName: user.fullName,
          email: user.email,
          avatar: user.avatar?.url || "",
          isBlocked,
          isArchived: archivedSet.has(user._id.toString()),
          hasPublicKey: Boolean(user.publicKey), // E2EE ready?
          unreadCount: isBlocked ? 0 : c?.unreadCount || 0,
          // e2ee message ho to lastMessage.text ciphertext hoga, client decrypt karega
          lastMessage: c ? formatMessage(c.lastMessage) : null,
          lastMessageAt: c?.lastMessage.createdAt || null,
          ts,
        };
      })
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

  /* ---------------- GET MESSAGES ---------------- */
  getMessage: asyncHandler(async (req, res) => {
    const { id: userToChatId } = req.params;
    const senderId = req.user._id;

    assertValidId(userToChatId, "User ID");

    const messages = await Message.find({
      $and: [
        {
          $or: [
            { senderId: senderId, receiverId: userToChatId },
            { senderId: userToChatId, receiverId: senderId },
          ],
        },
        notExpired(),
      ],
      deletedFor: { $ne: senderId },
    })
      .sort({ createdAt: 1 })
      .populate("replyTo", REPLY_SELECT);

    return new ApiResponse(
      StatusCodes.OK,
      messages.map(formatMessage),
      "User messages fetched successfully.",
    ).send(res);
  }),

  /* ---------------- SEND (reply + link preview + spam guard + E2EE) ---------------- */
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

    // E2EE sirf text pe lagta hai; text nahi hai to flag ignore
    // Frontend sends `encrypted`, accept `e2ee` as legacy fallback
    const wantsE2EE = parseBool(req.body.encrypted ?? req.body.e2ee) && Boolean(trimmedText);
    const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;

    // E2EE me maxLen ciphertext ki length hai, user ko wo number nahi dikhana.
    // Plaintext limit client pe encrypt karne se pehle check hoti hai.
    if (trimmedText && trimmedText.length > maxLen) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        wantsE2EE
          ? "Message is too long."
          : `Message is too long (max ${MAX_TEXT_LENGTH} characters).`,
      );
    }
    if (wantsE2EE) {
      assertValidCipher(trimmedText, iv); // base64 ciphertext + iv
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

    /* reply validation */
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

    const {
      image: uploadedImage,
      file: uploadedFile,
      audio: uploadedAudio,
      video: uploadedVideo,
    } = await processAttachment(req.file, {
      isVoice: isVoice === "true" || isVoice === true,
      isVideo: isVideo === "true" || isVideo === true,
      duration,
    });

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

    // server ciphertext ka link preview nahi bana sakta
    if (!wantsE2EE) attachLinkPreview(message); // background, no await

    return new ApiResponse(
      StatusCodes.CREATED,
      payload,
      "Message sent successfully.",
    ).send(res);
  }),

  /* ---------------- FORWARD ---------------- */
  // Encrypted original ko forward karne ke liye client ko har recipient ke liye
  // naya ciphertext bhejna hoga:
  //   body.encrypted = { "<recipientId>": { text: "<b64>", iv: "<b64>" }, ... }
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
      // encrypted text purani key se bana hai, naye receiver ke liye useless
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
              isLive: false, // forward = static pin, live share se nahi judega
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

  /* ---------------- EDIT ---------------- */
  // E2EE message edit: body = { text: "<new ciphertext>", iv: "<new iv>", e2ee: true }
  editMessage: asyncHandler(async (req, res) => {
    const { messageId } = req.params;
    const userId = req.user._id;
    const text = req.body.text?.trim();
    // Frontend sends `encrypted`, accept `e2ee` as legacy fallback
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

    // encrypted <-> plaintext mode edit me badla nahi ja sakta
    if (Boolean(message.e2ee) !== wantsE2EE) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Encryption mode of a message can't be changed.",
      );
    }
    if (wantsE2EE) assertValidCipher(text, iv);

    await assertCanMessage(userId, message.receiverId);
    if (wantsE2EE) await assertE2EEReady(userId, message.receiverId);

    // ciphertext har baar naya hota hai, isliye "no changes" check sirf plaintext ke liye
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

    io.to(message.receiverId.toString()).emit("messageEdited", payload);
    io.to(message.senderId.toString()).emit("messageEdited", payload);

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

    io.to(userId.toString()).emit("messagePinned", payload);
    io.to(otherId.toString()).emit("messagePinned", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Pin updated.").send(res);
  }),

  getPinned: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { id: otherId } = req.params;

    assertValidId(otherId, "user ID");

    const pinned = await Message.find({
      $and: [
        {
          $or: [
            { senderId: userId, receiverId: otherId },
            { senderId: otherId, receiverId: userId },
          ],
        },
        notExpired(),
      ],
      isPinned: true,
      isDeleted: { $ne: true },
      deletedFor: { $ne: userId },
    })
      .sort({ pinnedAt: -1 })
      .populate("replyTo", REPLY_SELECT);

    return new ApiResponse(
      StatusCodes.OK,
      pinned.map(formatMessage),
      "Pinned messages.",
    ).send(res);
  }),

  /* ---------------- SEARCH ---------------- */
  // E2EE messages server pe search nahi ho sakte (server ko plaintext nahi milta).
  // Client decrypted messages me local search kare.
  searchMessages: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { id: otherId } = req.params;
    const q = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit) || 30, 50);

    assertValidId(otherId, "user ID");

    if (q.length < 2) {
      return new ApiResponse(
        StatusCodes.OK,
        [],
        "Type at least 2 characters.",
      ).send(res);
    }

    const results = await Message.find({
      $and: [
        {
          $or: [
            { senderId: userId, receiverId: otherId },
            { senderId: otherId, receiverId: userId },
          ],
        },
        notExpired(),
      ],
      deletedFor: { $ne: userId },
      isDeleted: { $ne: true },
      e2ee: { $ne: true },
      text: { $regex: escapeRegex(q), $options: "i" },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("senderId receiverId text createdAt");

    return new ApiResponse(
      StatusCodes.OK,
      results.map((m) => ({
        id: m._id,
        senderId: m.senderId,
        text: m.text,
        createdAt: m.createdAt,
      })),
      "Search results.",
    ).send(res);
  }),

  /* ---------------- SCHEDULE ---------------- */
  // E2EE schedule: client schedule karte waqt hi encrypt karke ciphertext + iv bhejta hai.
  scheduleMessage: asyncHandler(async (req, res) => {
    const { id: receiverId } = req.params;
    const senderId = req.user._id;
    const text = req.body.text?.trim();
    // Frontend sends `encrypted`, accept `e2ee` as legacy fallback
    const wantsE2EE = parseBool(req.body.encrypted ?? req.body.e2ee);
    const iv = req.body.iv;
    const when = new Date(req.body.scheduledFor);

    assertValidId(receiverId, "receiver ID");

    if (receiverId.toString() === senderId.toString()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You cannot message yourself.",
      );
    }

    const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;
    if (!text || text.length > maxLen) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        wantsE2EE
          ? "Encrypted payload is invalid or too large."
          : `Text must be 1-${MAX_TEXT_LENGTH} characters.`,
      );
    }
    if (wantsE2EE) assertValidCipher(text, iv);

    if (
      Number.isNaN(when.getTime()) ||
      when.getTime() < Date.now() + 30_000 ||
      when.getTime() > Date.now() + 30 * 86_400_000
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Pick a time between 1 minute and 30 days from now.",
      );
    }

    await assertCanMessage(senderId, receiverId);
    if (wantsE2EE) await assertE2EEReady(senderId, receiverId);

    const doc = await ScheduledMessage.create({
      senderId,
      receiverId,
      text,
      scheduledFor: when,
      ...(wantsE2EE ? { e2ee: true, iv } : {}),
    });

    return new ApiResponse(StatusCodes.CREATED, doc, "Message scheduled.").send(
      res,
    );
  }),

  getScheduled: asyncHandler(async (req, res) => {
    const filter = { senderId: req.user._id, status: "pending" };
    if (req.query.to && mongoose.Types.ObjectId.isValid(req.query.to)) {
      filter.receiverId = req.query.to;
    }

    const list = await ScheduledMessage.find(filter).sort({ scheduledFor: 1 });

    return new ApiResponse(StatusCodes.OK, list, "Scheduled messages.").send(
      res,
    );
  }),

  cancelScheduled: asyncHandler(async (req, res) => {
    const { scheduleId } = req.params;
    assertValidId(scheduleId, "schedule ID");

    const doc = await ScheduledMessage.findOneAndUpdate(
      { _id: scheduleId, senderId: req.user._id, status: "pending" },
      { status: "cancelled" },
    );
    if (!doc) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Scheduled message not found.");
    }

    return new ApiResponse(
      StatusCodes.OK,
      { id: doc._id },
      "Scheduled message cancelled.",
    ).send(res);
  }),

  markMessagesSeen: asyncHandler(async (req, res) => {
    const { id: otherUserId } = req.params;
    const userId = req.user._id;

    assertValidId(otherUserId, "user ID");

    const { readReceipts } = getPrivacy(userId);

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

      if (readReceipts) {
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

    io.to(otherUserId.toString()).emit("messageReaction", payload);
    io.to(userId.toString()).emit("messageReaction", payload);

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

    io.to(message.receiverId.toString()).emit("messageDeleted", payload);
    io.to(message.senderId.toString()).emit("messageDeleted", payload);

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
    const { id: reportedUserId } = req.params;
    const reporterId = req.user._id;
    const { reason, details, messageId } = req.body;

    assertValidId(reportedUserId, "user ID");

    if (reportedUserId.toString() === reporterId.toString()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You cannot report yourself.",
      );
    }
    if (!REPORT_REASONS.includes(reason)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Please choose a valid reason.",
      );
    }

    const reported = await User.exists({ _id: reportedUserId });
    if (!reported) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    if (messageId) {
      assertValidId(messageId, "message ID");
      const m = await Message.findById(messageId).select("senderId receiverId");
      if (!m || !isBetween(m, reporterId, reportedUserId)) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Invalid message for report.",
        );
      }
    }

    const recent = await Report.exists({
      reporterId,
      reportedUserId,
      createdAt: { $gt: new Date(Date.now() - 24 * 3600_000) },
    });
    if (recent) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "You already reported this user in the last 24 hours.",
      );
    }

    await Report.create({
      reporterId,
      reportedUserId,
      messageId: messageId || undefined,
      reason,
      details: details?.toString().trim().slice(0, 500) || undefined,
    });

    return new ApiResponse(
      StatusCodes.CREATED,
      null,
      "Report submitted. Thank you.",
    ).send(res);
  }),

  getDisappearing: asyncHandler(async (req, res) => {
    const { id: otherId } = req.params;
    assertValidId(otherId, "user ID");

    const seconds = await getDisappearAfter(req.user._id, otherId);

    return new ApiResponse(
      StatusCodes.OK,
      { seconds },
      "Disappearing setting.",
    ).send(res);
  }),

  setDisappearing: asyncHandler(async (req, res) => {
    const { id: otherId } = req.params;
    const userId = req.user._id;
    const seconds = Number(req.body.seconds);

    assertValidId(otherId, "user ID");

    if (otherId.toString() === userId.toString()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user.");
    }
    if (!ALLOWED_TIMERS.includes(seconds)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid timer value.");
    }

    await assertCanMessage(userId, otherId);

    await ChatSetting.findOneAndUpdate(
      { pairKey: pairKeyOf(userId, otherId) },
      { disappearAfter: seconds, updatedBy: userId },
      { upsert: true },
    );

    io.to(userId.toString()).emit("disappearingUpdated", {
      userId: otherId.toString(),
      seconds,
      by: userId,
    });
    io.to(otherId.toString()).emit("disappearingUpdated", {
      userId: userId.toString(),
      seconds,
      by: userId,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { seconds },
      seconds
        ? "Disappearing messages turned on."
        : "Disappearing messages turned off.",
    ).send(res);
  }),

  setArchive: asyncHandler(async (req, res) => {
    const { id: otherId } = req.params;
    const userId = req.user._id;
    const archived = req.body.archived === true || req.body.archived === "true";

    assertValidId(otherId, "user ID");

    if (otherId.toString() === userId.toString()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user.");
    }
    if (!(await User.exists({ _id: otherId }))) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    if (archived) {
      await ChatArchive.updateOne(
        { ownerId: userId, otherId },
        { $setOnInsert: { ownerId: userId, otherId } },
        { upsert: true },
      );
    } else {
      await ChatArchive.deleteOne({ ownerId: userId, otherId });
    }

    io.to(userId.toString()).emit("chatArchived", {
      userId: otherId.toString(),
      archived,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { userId: otherId, archived },
      archived ? "Chat archived." : "Chat unarchived.",
    ).send(res);
  }),

  /* ---------------- LOCATION: START ---------------- */
  // NOTE: location lat/lng abhi plaintext hai (server live tracking ke liye use karta hai).
  // current -> data = message payload
  // live    -> data = { message, share }
  startShare: asyncHandler(async (req, res) => {
    const senderId = req.user._id;
    const { receiverId, mode } = req.body;

    const lat = toNum(req.body.lat);
    const lng = toNum(req.body.lng);
    const accuracy = toNum(req.body.accuracy);
    const durationMin = toNum(req.body.durationMin);

    assertValidId(receiverId, "receiver ID");

    if (receiverId.toString() === senderId.toString()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You cannot share location with yourself.",
      );
    }
    if (mode !== "current" && mode !== "live") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share mode.");
    }
    if (!validCoords(lat, lng)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid location.");
    }

    await assertCanMessage(senderId, receiverId);

    const safeAccuracy = Number.isFinite(accuracy) ? accuracy : undefined;

    /* ---- one-time pin ---- */
    if (mode === "current") {
      const { payload } = await deliverMessage({
        senderId,
        receiverId,
        data: {
          location: { lat, lng, accuracy: safeAccuracy, isLive: false },
        },
      });

      return new ApiResponse(
        StatusCodes.CREATED,
        payload,
        "Location sent.",
      ).send(res);
    }

    /* ---- live share ---- */
    if (!LIVE_DURATIONS_MIN.includes(durationMin)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid duration.");
    }

    // is chat me pehle se koi live share ho to band karo
    const previous = await LocationShare.find({
      sharerId: senderId,
      receiverId,
      status: "active",
    });
    for (const old of previous) {
      old.status = "stopped";
      old.endedAt = new Date();
      await old.save();
      emitToPair(old.sharerId, old.receiverId, "location:ended", {
        shareId: String(old._id),
      });
    }

    const now = new Date();
    const share = await LocationShare.create({
      sharerId: senderId,
      receiverId,
      expiresAt: new Date(now.getTime() + durationMin * 60_000),
      lastLocation: { lat, lng, accuracy: safeAccuracy, updatedAt: now },
    });

    let result;
    try {
      result = await deliverMessage({
        senderId,
        receiverId,
        data: {
          location: {
            lat,
            lng,
            accuracy: safeAccuracy,
            isLive: true,
            shareId: share._id,
          },
        },
      });
    } catch (error) {
      await LocationShare.deleteOne({ _id: share._id });
      throw error;
    }

    share.messageId = result.message._id;
    await share.save();

    // pehla update turant bhejo, taaki receiver ko "Live location ended" na dikhe
    emitToPair(senderId, receiverId, "location:update", {
      shareId: String(share._id),
      lat,
      lng,
      accuracy: safeAccuracy,
      updatedAt: now,
    });

    return new ApiResponse(
      StatusCodes.CREATED,
      { message: result.payload, share },
      "Live location started.",
    ).send(res);
  }),

  /* ---------------- LOCATION: STOP ---------------- */
  stopShare: asyncHandler(async (req, res) => {
    const { id: shareId } = req.params;
    const userId = req.user._id;

    assertValidId(shareId, "share ID");

    const share = await LocationShare.findOne({
      _id: shareId,
      sharerId: userId,
      status: "active",
    });
    if (!share) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Live share not found.");
    }

    share.status = "stopped";
    share.endedAt = new Date();
    await share.save();

    emitToPair(share.sharerId, share.receiverId, "location:ended", {
      shareId: String(share._id),
    });

    return new ApiResponse(
      StatusCodes.OK,
      { shareId: share._id },
      "Live location stopped.",
    ).send(res);
  }),

  /* ---------------- LOCATION: ACTIVE LIST ---------------- */
  // data = { mine: [share...], forMe: [share...] }
  getActiveShares: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const now = new Date();

    // purane expired shares ko band mark karo
    await LocationShare.updateMany(
      { status: "active", expiresAt: { $lte: now } },
      { status: "expired", endedAt: now },
    );

    const [mine, forMe] = await Promise.all([
      LocationShare.find({
        sharerId: userId,
        status: "active",
        expiresAt: { $gt: now },
      }),
      LocationShare.find({
        receiverId: userId,
        status: "active",
        expiresAt: { $gt: now },
      }),
    ]);

    return new ApiResponse(
      StatusCodes.OK,
      { mine, forMe },
      "Active location shares.",
    ).send(res);
  }),
};

export default messageController;
