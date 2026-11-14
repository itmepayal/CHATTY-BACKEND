import GroupMessage from "../models/group-message.model.js";
import { deleteFileToCloudinary } from "../../../config/cloudinary.config.js";
import { sid } from "./group.helpers.js";

export const isTextOnlyMessage = (message) => {
  if (!message) return false;
  return (
    Boolean(message.text) &&
    !message.image?.url &&
    !message.file?.url &&
    !message.audio?.url &&
    !message.video?.url &&
    !message.location?.lat
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
          mimeType: msg.audio.mimeType || "audio/mp4",
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
    silentReadBy: (msg.silentReadBy || []).map(String),
    isEdited: Boolean(msg.isEdited),
    editedAt: msg.editedAt || null,
    createdAt: msg.createdAt,
  };
};

export const findGroupMessageDuplicate = (groupId, senderId, clientId) =>
  GroupMessage.findOne({ groupId, senderId, clientId }).populate(
    "senderId",
    "fullName avatar",
  );

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
