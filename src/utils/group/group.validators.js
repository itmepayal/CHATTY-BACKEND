import { StatusCodes } from "http-status-codes";
import ApiError from "../api-error.js";
import GroupKey from "../../models/group-key.model.js";
import { parseBool, assertValidCipher } from "../e2ee.js";
import {
  MAX_GROUP_TEXT,
  MAX_CIPHERTEXT_LENGTH,
  GROUP_NAME_MIN,
  GROUP_NAME_MAX,
} from "../../constants/group/group.constants.js";
import { getLatestKeyVersion } from "./group.helpers.js";

export const validName = (name) => {
  if (
    !name ||
    typeof name !== "string" ||
    name.trim().length < GROUP_NAME_MIN ||
    name.trim().length > GROUP_NAME_MAX
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Group name must be ${GROUP_NAME_MIN}-${GROUP_NAME_MAX} characters.`,
    );
  }
};

export const validateGroupMessageInput = async (group, me, body, file) => {
  const wantsE2EE = parseBool(body.encrypted ?? body.e2ee);
  const text = wantsE2EE
    ? typeof body.text === "string"
      ? body.text
      : ""
    : body.text?.trim();
  const isVoice = body.isVoice === "true" || body.isVoice === true;
  const isVideo = body.isVideo === "true" || body.isVideo === true;

  if (!text && !file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
  }
  if (
    text &&
    text.length > (wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_GROUP_TEXT)
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Message can be at most ${MAX_GROUP_TEXT} characters.`,
    );
  }
  if (isVoice && file && !file.mimetype?.startsWith("audio/")) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Voice message must be an audio file.",
    );
  }
  if (isVideo && file && !file.mimetype?.startsWith("video/")) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Video message must be a video file.",
    );
  }

  const latestVersion = await getLatestKeyVersion(group._id);
  let cipher = {};

  if (latestVersion > 0 && text && !wantsE2EE) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "This group is end-to-end encrypted. Send encrypted text only.",
    );
  }

  if (wantsE2EE) {
    if (!latestVersion) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "Encryption is not enabled for this group.",
      );
    }
    if (!text) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Encrypted message needs ciphertext.",
      );
    }
    assertValidCipher(text, body.iv);

    const keyVersion = Number(body.keyVersion);
    if (
      !Number.isInteger(keyVersion) ||
      keyVersion < 1 ||
      keyVersion > latestVersion
    ) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid key version.");
    }

    if (group.keyRotationPending && keyVersion === latestVersion) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "Group key is being rotated. Please try again in a moment.",
      );
    }

    const hasKey = await GroupKey.exists({
      groupId: group._id,
      userId: me,
      version: keyVersion,
    });
    if (!hasKey) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "You don't have the key for this version.",
      );
    }

    cipher = { e2ee: true, iv: body.iv, keyVersion };
  }

  return { text, cipher, wantsE2EE, isVoice, isVideo };
};

export const validateInitialKeyEntries = ({ keyEntries, me, memberIds }) => {
  const allIds = [me, ...memberIds].map(String);
  const providedIds = new Set(keyEntries.map((e) => String(e.userId)));

  const missing = allIds.filter((id) => !providedIds.has(id));
  if (missing.length) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Key entries must include every member.",
    );
  }

  if (keyEntries.some((e) => Number(e.version) !== 1)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Initial group key version must be 1.",
    );
  }
};
