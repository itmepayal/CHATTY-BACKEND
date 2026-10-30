import Message from "../models/message.model.js";
import { deleteFileToCloudinary } from "../config/cloudinary.config.js";

const isAssetShared = async (field, publicId, messageId) =>
  (await Message.countDocuments({
    [`${field}.public_id`]: publicId,
    _id: { $ne: messageId },
  })) > 0;

const destroyAsset = async (message, field, defaultType) => {
  const asset = message[field];
  const publicId = asset?.public_id;
  if (!publicId) return;
  if (await isAssetShared(field, publicId, message._id)) return;

  try {
    await deleteFileToCloudinary(publicId, asset.resourceType || defaultType);
  } catch (err) {
    console.error(`Cloudinary ${field} delete failed:`, err?.message || err);
  }
};

export const wipeMessage = async (message) => {
  await destroyAsset(message, "image", "image");
  await destroyAsset(message, "file", "raw");
  await destroyAsset(message, "audio", "video");
  await destroyAsset(message, "video", "video");

  message.isDeleted = true;
  message.deletedAt = new Date();
  message.text = undefined;
  message.image = undefined;
  message.file = undefined;
  message.audio = undefined;
  message.video = undefined;
  message.linkPreview = undefined;
  message.reactions = [];
  message.isPinned = false;
  message.pinnedBy = undefined;
  message.pinnedAt = undefined;
  await message.save();
};
