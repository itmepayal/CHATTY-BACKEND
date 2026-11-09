import ApiError from "../../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import { uploadFileToCloudinary } from "../../config/cloudinary.config.js";
import {
  MAX_VOICE_SECONDS,
  MAX_VIDEO_SECONDS,
} from "../../constants/messages.constants.js";

/**
 * Moved from services/message.service.js:L93-160
 */
export const processAttachment = async (
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
