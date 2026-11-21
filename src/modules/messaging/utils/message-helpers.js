import mongoose from "mongoose";
import Message from "../models/message.model.js";
import { io } from "../../../infrastructure/socket/socket.js";

export const toObjectId = (id) => new mongoose.Types.ObjectId(id);

export const REPLY_SELECT =
  "senderId text image file audio video location gift messageType isDeleted e2ee iv keyEnvelopes";

const formatFile = (file) =>
  file?.url
    ? {
        url: file.url,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
      }
    : null;

const formatAudio = (audio) =>
  audio?.url
    ? {
        url: audio.url,
        duration: audio.duration || 0,
        mimeType: audio.mimeType || "audio/mp4",
      }
    : null;

const formatVideo = (video) =>
  video?.url
    ? {
        url: video.url,
        duration: video.duration || 0,
        mimeType: video.mimeType,
      }
    : null;

const hasLatLng = (loc) =>
  Number.isFinite(loc?.lat) && Number.isFinite(loc?.lng);

const formatLocation = (loc) =>
  hasLatLng(loc)
    ? {
        lat: loc.lat,
        lng: loc.lng,
        accuracy: loc.accuracy,
        isLive: Boolean(loc.isLive),
        shareId: loc.shareId ? String(loc.shareId) : null,
      }
    : null;

const formatReply = (r) => {
  if (!r || typeof r !== "object" || !r.senderId) return null;
  if (r.isDeleted) return { id: String(r._id), isDeleted: true };

  const isEncrypted = Boolean(r.e2ee);
  return {
    id: String(r._id),
    senderId: String(r.senderId),
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
              : hasLatLng(r.location)
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
    audio: formatAudio(r.audio),
    video: formatVideo(r.video),
    location: hasLatLng(r.location)
      ? { lat: r.location.lat, lng: r.location.lng }
      : null,
    isDeleted: false,
  };
};

export const formatPollHelper = (poll) => {
  if (!poll || !poll.question) return null;
  const isClosed = Boolean(poll.isClosed || poll.isEnded);
  const rawOptions = Array.isArray(poll.options) ? poll.options : [];
  const options = rawOptions.map((opt) => {
    const rawVotes = Array.isArray(opt.votes) ? opt.votes : [];
    const voteCount = rawVotes.length;
    return {
      _id: String(opt._id || opt.id || opt.text),
      text: opt.text,
      votes: rawVotes.map((v) =>
        typeof v === "object" && v !== null && (v._id || v.id)
          ? {
              id: String(v._id || v.id),
              fullName: v.fullName || "",
              username: v.username || "",
              avatar:
                v.avatar?.url ||
                (typeof v.avatar === "string" ? v.avatar : "") ||
                v.profilePic ||
                "",
            }
          : String(v)
      ),
      voteCount,
    };
  });

  const totalVotes = options.reduce((sum, o) => sum + o.voteCount, 0);

  return {
    question: poll.question,
    type: poll.type || (poll.allowMultipleAnswers ? "multiple" : "single"),
    options,
    isAnonymous: Boolean(poll.isAnonymous),
    allowMultipleAnswers: Boolean(poll.allowMultipleAnswers),
    canChangeVote: poll.canChangeVote !== false,
    isClosed,
    isEnded: isClosed,
    closedBy: poll.closedBy
      ? String(poll.closedBy._id || poll.closedBy.id || poll.closedBy)
      : null,
    closedAt: poll.closedAt || poll.endedAt || null,
    endedAt: poll.endedAt || poll.closedAt || null,
    createdBy: poll.createdBy
      ? String(poll.createdBy._id || poll.createdBy.id || poll.createdBy)
      : null,
    expiresAt: poll.expiresAt || null,
    totalVotes,
  };
};

export const formatMessage = (msg) => {
  const deleted = Boolean(msg.isDeleted);
  const isEncrypted = !deleted && Boolean(msg.e2ee);

  const senderId = msg.senderId?._id
    ? String(msg.senderId._id)
    : msg.senderId?.id
      ? String(msg.senderId.id)
      : String(msg.senderId);

  const receiverId = msg.receiverId?._id
    ? String(msg.receiverId._id)
    : msg.receiverId?.id
      ? String(msg.receiverId.id)
      : String(msg.receiverId);

  const sender =
    msg.senderId && typeof msg.senderId === "object" && (msg.senderId._id || msg.senderId.id)
      ? {
          id: String(msg.senderId._id || msg.senderId.id),
          fullName: msg.senderId.fullName || "",
          username: msg.senderId.username || "",
          avatar:
            msg.senderId.avatar?.url ||
            (typeof msg.senderId.avatar === "string" ? msg.senderId.avatar : "") ||
            msg.senderId.profilePic ||
            "",
        }
      : undefined;

  const receiver =
    msg.receiverId && typeof msg.receiverId === "object" && (msg.receiverId._id || msg.receiverId.id)
      ? {
          id: String(msg.receiverId._id || msg.receiverId.id),
          fullName: msg.receiverId.fullName || "",
          username: msg.receiverId.username || "",
          avatar:
            msg.receiverId.avatar?.url ||
            (typeof msg.receiverId.avatar === "string" ? msg.receiverId.avatar : "") ||
            msg.receiverId.profilePic ||
            "",
        }
      : undefined;

  return {
    id: String(msg._id),
    senderId,
    receiverId,
    sender,
    receiver,
    text: deleted ? "" : msg.text,
    encrypted: isEncrypted,
    iv: isEncrypted ? msg.iv || null : null,
    keyEnvelopes:
      isEncrypted && Array.isArray(msg.keyEnvelopes)
        ? msg.keyEnvelopes.map((env) => ({
            deviceId: String(env.deviceId),
            userId: String(env.userId),
            wrappedKey: env.wrappedKey,
            iv: env.iv,
          }))
        : [],
    image:
      !deleted && msg.image?.url
        ? { url: msg.image.url, public_id: msg.image.public_id }
        : null,
    file: deleted ? null : formatFile(msg.file),
    audio: deleted ? null : formatAudio(msg.audio),
    video: deleted ? null : formatVideo(msg.video),
    location: deleted ? null : formatLocation(msg.location),
    clientId: msg.clientId,
    reactions: deleted
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
    poll: deleted ? null : formatPollHelper(msg.poll),
    gift:
      !deleted && msg.gift?.name
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
    replyTo: deleted ? null : formatReply(msg.replyTo),
    isForwarded: Boolean(msg.isForwarded),
    isPinned: deleted ? false : Boolean(msg.isPinned),
    isStarred: Boolean(msg.starredBy && msg.starredBy.length > 0),
    starredBy: Array.isArray(msg.starredBy) ? msg.starredBy.map(String) : [],
    isEdited: Boolean(msg.isEdited),
    editedAt: msg.editedAt,
    linkPreview:
      !deleted && msg.linkPreview?.url
        ? {
            url: msg.linkPreview.url,
            title: msg.linkPreview.title,
            description: msg.linkPreview.description,
            image: msg.linkPreview.image,
            siteName: msg.linkPreview.siteName,
          }
        : null,
    isDeleted: deleted,
    status: msg.status || "sent",
    deliveredAt: msg.deliveredAt,
    seenAt: msg.seenAt,
    createdAt: msg.createdAt,
  };
};

export const isParticipantOf = (message, userId) =>
  message.senderId.toString() === userId.toString() ||
  message.receiverId.toString() === userId.toString();

export const getOtherUserId = (message, userId) =>
  message.senderId.toString() === userId.toString()
    ? message.receiverId
    : message.senderId;

export const isBetween = (m, a, b) => {
  const s = m.senderId.toString();
  const r = m.receiverId.toString();
  return (
    (s === a.toString() && r === b.toString()) ||
    (s === b.toString() && r === a.toString())
  );
};

const unreadFilter = (receiverId, senderId) => ({
  receiverId: toObjectId(receiverId),
  senderId: toObjectId(senderId),
  status: { $ne: "seen" },
  receiverReadAt: null,
  isDeleted: { $ne: true },
  deletedFor: { $ne: toObjectId(receiverId) },
  $and: [
    {
      receiverId: toObjectId(receiverId),
      senderId: toObjectId(senderId),
      status: { $ne: "seen" },
      receiverReadAt: null,
      isDeleted: { $ne: true },
      deletedFor: { $ne: toObjectId(receiverId) },
    },
    notExpired(),
  ],
});

const getUnreadCount = (receiverId, senderId) =>
  Message.countDocuments(unreadFilter(receiverId, senderId));

const getLastMessage = async (ownerId, otherId) => {
  const owner = toObjectId(ownerId);
  const other = toObjectId(otherId);

  const msg = await Message.findOne({
    $and: [
      {
        $or: [
          { senderId: owner, receiverId: other },
          { senderId: other, receiverId: owner },
        ],
      },
      notExpired(),
    ],
    deletedFor: { $ne: owner },
  }).sort({ createdAt: -1 });

  return msg ? formatMessage(msg) : null;
};

export const emitConversationUpdate = async (ownerId, otherId) => {
  try {
    const ts = Date.now();
    const [unreadCount, lastMessage] = await Promise.all([
      getUnreadCount(ownerId, otherId),
      getLastMessage(ownerId, otherId),
    ]);

    io.to(ownerId.toString()).emit("conversationUpdated", {
      userId: otherId.toString(),
      unreadCount,
      lastMessage,
      lastMessageAt: lastMessage?.createdAt ?? null,
      ts,
    });
  } catch (err) {
    console.error("emitConversationUpdate failed:", err?.message || err);
  }
};

export const emitToPair = (a, b, event, payload) => {
  io.to(a.toString()).emit(event, payload);
  io.to(b.toString()).emit(event, payload);
};

export const notExpired = () => ({
  $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
});

export const isExpired = (message) =>
  Boolean(message?.expiresAt) && message.expiresAt.getTime() <= Date.now();
