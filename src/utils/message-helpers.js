import mongoose from "mongoose";
import Message from "../models/message.model.js";
import { io } from "../lib/socket.js";

export const toObjectId = (id) => new mongoose.Types.ObjectId(id);

export const REPLY_SELECT =
  "senderId text image file audio video location isDeleted e2ee iv";

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
        mimeType: audio.mimeType,
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
  if (r.isDeleted) return { id: r._id, isDeleted: true };

  return {
    id: r._id,
    senderId: r.senderId,
    text: (r.text || "").slice(0, 120),
    type: r.image?.url
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
    image: r.image?.url ? { url: r.image.url } : null,
    file: r.file?.url ? { name: r.file.name } : null,
    audio: r.audio?.url ? { url: r.audio.url } : null,
    video: r.video?.url ? { url: r.video.url } : null,
    location: hasLatLng(r.location)
      ? { lat: r.location.lat, lng: r.location.lng }
      : null,
    isDeleted: false,
  };
};

export const formatMessage = (msg) => {
  const deleted = Boolean(msg.isDeleted);
  const isEncrypted = !deleted && Boolean(msg.e2ee);

  return {
    id: msg._id,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    text: deleted ? "" : msg.text,
    encrypted: isEncrypted,
    iv: isEncrypted ? msg.iv || null : null,
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
          userId: r.userId,
          emoji: r.emoji,
        })),
    replyTo: deleted ? null : formatReply(msg.replyTo),
    isForwarded: Boolean(msg.isForwarded),
    isPinned: deleted ? false : Boolean(msg.isPinned),
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
});

const getUnreadCount = (receiverId, senderId) =>
  Message.countDocuments(unreadFilter(receiverId, senderId));

const getLastMessage = async (ownerId, otherId) => {
  const owner = toObjectId(ownerId);
  const other = toObjectId(otherId);

  const msg = await Message.findOne({
    $or: [
      { senderId: owner, receiverId: other },
      { senderId: other, receiverId: owner },
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
