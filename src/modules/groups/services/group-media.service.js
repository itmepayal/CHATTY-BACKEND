import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import { uploadFileToCloudinary } from "../../../config/cloudinary.config.js";
import {
  MAX_VOICE_SECONDS,
  MAX_VIDEO_SECONDS,
} from "../../messaging/constants/messages.constants.js";
import { detectVoiceMedia } from "../../messaging/services/attachments/message-attachment.service.js";

export const uploadImage = async (file) => {
  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload image.");
  }
  return { public_id: up.public_id, url: up.secure_url };
};

export const uploadAttachment = async (
  file,
  { isVoice = false, isVideo = false, duration } = {},
) => {
  let voiceDetection = null;
  if (isVoice) {
    voiceDetection = await detectVoiceMedia(file);
  }

  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload attachment.");
  }

  if (file.mimetype?.startsWith("image/")) {
    return { image: { public_id: up.public_id, url: up.secure_url } };
  }

  if (isVoice && voiceDetection?.isAudio) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      audio: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VOICE_SECONDS),
        mimeType: voiceDetection.mimeType,
        resourceType: up.resource_type || "video",
      },
    };
  }

  if (isVideo && file.mimetype?.startsWith("video/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
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

const groupMediaService = {
  uploadImage,
  uploadAttachment,
};

export default groupMediaService;

