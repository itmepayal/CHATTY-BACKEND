import fs from "fs/promises";
import path from "path";
import ApiError from "../../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";
import { uploadFileToCloudinary } from "../../../../config/cloudinary.config.js";
import {
  MAX_VOICE_SECONDS,
  MAX_VIDEO_SECONDS,
} from "../../constants/messages.constants.js";

export const detectVoiceMedia = async (file) => {
  if (!file) return { isAudio: false, mimeType: "application/octet-stream" };

  const rawMime = (file.mimetype || "").toLowerCase().split(";")[0].trim();
  const ext = path.extname(file.originalname || "").toLowerCase();

  const AUDIO_MIMES = new Set([
    "audio/mp4",
    "audio/m4a",
    "audio/x-m4a",
    "audio/aac",
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/wave",
    "audio/x-wav",
    "audio/ogg",
    "audio/opus",
    "audio/webm",
    "audio/flac",
    "audio/3gpp",
    "audio/amr",
  ]);

  if (AUDIO_MIMES.has(rawMime) || rawMime.startsWith("audio/")) {
    const normalized =
      rawMime === "audio/x-m4a" || rawMime === "audio/m4a"
        ? "audio/mp4"
        : rawMime === "audio/mp3"
          ? "audio/mpeg"
          : rawMime;
    return { isAudio: true, mimeType: normalized };
  }

  let header = null;
  if (file.path) {
    try {
      const handle = await fs.open(file.path, "r");
      const buffer = Buffer.alloc(64);
      const { bytesRead } = await handle.read(buffer, 0, 64, 0);
      await handle.close();
      header = buffer.subarray(0, bytesRead);
    } catch {}
  }

  if (header && header.length >= 4) {
    if (header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53) {
      return { isAudio: true, mimeType: "audio/ogg" };
    }
    if (header[0] === 0x49 && header[1] === 0x44 && header[2] === 0x33) {
      return { isAudio: true, mimeType: "audio/mpeg" };
    }
    if (header[0] === 0xff && (header[1] & 0xe0) === 0xe0) {
      return { isAudio: true, mimeType: "audio/mpeg" };
    }
    if (
      header.length >= 12 &&
      header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46 &&
      header[8] === 0x57 && header[9] === 0x41 && header[10] === 0x56 && header[11] === 0x45
    ) {
      return { isAudio: true, mimeType: "audio/wav" };
    }
    if (header[0] === 0x1a && header[1] === 0x45 && header[2] === 0xdf && header[3] === 0xa3) {
      if (ext === ".weba" || ext === ".webm" || rawMime.includes("webm") || rawMime.includes("audio")) {
        return { isAudio: true, mimeType: "audio/webm" };
      }
    }
    if (
      header.length >= 12 &&
      header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70
    ) {
      const brand = header.subarray(8, 12).toString("ascii").trim();
      const isM4aBrand = brand === "M4A" || brand === "M4B" || brand === "M4P" || brand === "F4A";
      if (isM4aBrand || ext === ".m4a" || ext === ".aac") {
        return { isAudio: true, mimeType: "audio/mp4" };
      }
    }
    if (header[0] === 0xff && (header[1] & 0xf6) === 0xf0) {
      return { isAudio: true, mimeType: "audio/aac" };
    }
  }

  const AUDIO_EXTS = new Set([".m4a", ".aac", ".mp3", ".wav", ".ogg", ".opus", ".weba"]);
  if (AUDIO_EXTS.has(ext)) {
    const extMimeMap = {
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".ogg": "audio/ogg",
      ".opus": "audio/ogg",
      ".weba": "audio/webm",
    };
    return { isAudio: true, mimeType: extMimeMap[ext] || "audio/mp4" };
  }

  return { isAudio: false, mimeType: rawMime || "application/octet-stream" };
};

export const processAttachment = async (
  file,
  { isVoice = false, isVideo = false, duration } = {},
) => {
  if (!file?.path) {
    return { image: null, file: null, audio: null, video: null };
  }

  let voiceDetection = null;
  if (isVoice) {
    voiceDetection = await detectVoiceMedia(file);
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

  if (isVoice && voiceDetection?.isAudio) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      image: null,
      file: null,
      video: null,
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
      image: null,
      file: null,
      audio: null,
      video: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VIDEO_SECONDS),
        mimeType: file.mimetype.split(";")[0],
        resourceType: up.resource_type || "video",
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

const messageAttachmentService = {
  processAttachment,
};

export default messageAttachmentService;

