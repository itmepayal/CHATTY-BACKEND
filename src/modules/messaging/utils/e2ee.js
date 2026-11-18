import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import {
  MAX_CIPHERTEXT_LENGTH,
  MAX_WRAPPED_KEY_LENGTH,
  MAX_KEY_ENTRIES,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  BASE64_ENCODING,
} from "../constants/messages.constants.js";

const IV_BYTES = AES_GCM_IV_BYTES;
const GCM_TAG_BYTES = AES_GCM_TAG_BYTES;
const DECODE_ENC = BASE64_ENCODING;

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export {
  MAX_CIPHERTEXT_LENGTH,
  MAX_WRAPPED_KEY_LENGTH,
} from "../constants/messages.constants.js";

export const parseBool = (v) => v === true || v === "true";

export const isBase64 = (v, { min = 1, max = Infinity } = {}) =>
  typeof v === "string" &&
  v.length >= min &&
  v.length <= max &&
  v.length % 4 === 0 &&
  B64_RE.test(v);

export const assertValidIv = (iv) => {
  const bufLen =
    typeof iv === "string" ? Buffer.from(iv, DECODE_ENC).length : 0;
  if (
    !isBase64(iv, { min: 16, max: 24 }) ||
    (bufLen !== IV_BYTES && bufLen !== 16)
  ) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid encryption IV.");
  }
};

export const assertValidCipher = (text, iv) => {
  if (!isBase64(text, { min: 24, max: MAX_CIPHERTEXT_LENGTH })) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid encrypted payload.");
  }
  if (Buffer.from(text, DECODE_ENC).length <= GCM_TAG_BYTES) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid encrypted payload.");
  }
  assertValidIv(iv);
};

export const parseKeyEntries = (raw, defaultVersion) => {
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid keys payload.");
    }
  }
  if (!Array.isArray(arr) || !arr.length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Keys are required.");
  }
  if (arr.length > MAX_KEY_ENTRIES) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Too many keys.");
  }

  const map = new Map();
  for (const e of arr) {
    const userId = String(e?.userId || "");
    const version = Number(e?.version ?? defaultVersion);

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID in keys.");
    }
    if (!Number.isInteger(version) || version < 1) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid key version.");
    }
    const wrappedKey = e?.wrappedKey ?? e?.encryptedKey;
    if (!isBase64(wrappedKey, { min: 16, max: MAX_WRAPPED_KEY_LENGTH })) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid wrapped key.");
    }
    assertValidIv(e?.iv);

    map.set(`${userId}:${version}`, {
      userId,
      version,
      wrappedKey,
      iv: e.iv,
    });
  }
  return [...map.values()];
};

/**
 * Validates, sanitizes, and deduplicates key envelopes for encrypted messages.
 * Enforces cross-user isolation, device ID constraints, and envelope requirements.
 *
 * @param {Array|string} rawEnvelopes - Array or JSON string of key envelopes
 * @param {object} options
 * @param {string|mongoose.Types.ObjectId} [options.senderId] - Allowed sender ID
 * @param {string|mongoose.Types.ObjectId} [options.receiverId] - Allowed receiver ID
 * @param {Array<string|mongoose.Types.ObjectId>} [options.allowedUserIds] - Explicit allowed user IDs
 * @param {boolean} [options.requireReceiverEnvelope=false] - Whether recipient envelope is required
 * @returns {Array<{ deviceId: string, userId: mongoose.Types.ObjectId, wrappedKey: string, iv: string }>}
 */
export const sanitizeAndValidateEnvelopes = (
  rawEnvelopes,
  {
    senderId = null,
    receiverId = null,
    allowedUserIds = null,
    requireReceiverEnvelope = false,
  } = {},
) => {
  let parsed = rawEnvelopes;
  if (typeof rawEnvelopes === "string") {
    try {
      parsed = JSON.parse(rawEnvelopes);
    } catch {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid key envelopes format.",
      );
    }
  }

  if (!parsed) {
    if (requireReceiverEnvelope) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Key envelopes are required for encrypted message.",
      );
    }
    return [];
  }

  if (!Array.isArray(parsed)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Key envelopes must be an array.",
    );
  }

  if (parsed.length === 0) {
    if (requireReceiverEnvelope) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Key envelopes are required for encrypted message.",
      );
    }
    return [];
  }

  if (parsed.length > MAX_KEY_ENTRIES) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Too many key envelopes.");
  }

  const allowedSet = new Set();
  if (Array.isArray(allowedUserIds)) {
    for (const uid of allowedUserIds) {
      if (uid) allowedSet.add(String(uid));
    }
  }
  if (senderId) allowedSet.add(String(senderId));
  if (receiverId) allowedSet.add(String(receiverId));

  const dedupeMap = new Map();
  let hasReceiverEnvelope = false;
  const targetReceiverStr = receiverId ? String(receiverId) : null;

  for (const env of parsed) {
    if (!env || typeof env !== "object") {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid key envelope item.");
    }

    const userIdStr = String(env.userId || "");
    if (!mongoose.Types.ObjectId.isValid(userIdStr)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid user ID in key envelope.",
      );
    }

    if (allowedSet.size > 0 && !allowedSet.has(userIdStr)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Unauthorized user in key envelopes.",
      );
    }

    const deviceId = String(env.deviceId || "").trim();
    if (!deviceId || deviceId.length > 128) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid device ID in key envelope.",
      );
    }

    if (deviceId === "device-session-fallback") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Static fallback device ID is not permitted in key envelopes.",
      );
    }

    const wrappedKey = String(env.wrappedKey || env.encryptedKey || "").trim();
    if (
      !wrappedKey ||
      wrappedKey.length > MAX_WRAPPED_KEY_LENGTH
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid wrapped key in key envelope.",
      );
    }

    const iv = String(env.iv || "");
    assertValidIv(iv);

    if (targetReceiverStr && userIdStr === targetReceiverStr) {
      hasReceiverEnvelope = true;
    }

    const dedupeKey = `${userIdStr}:${deviceId}`;
    if (!dedupeMap.has(dedupeKey)) {
      dedupeMap.set(dedupeKey, {
        deviceId,
        userId: new mongoose.Types.ObjectId(userIdStr),
        wrappedKey,
        iv,
      });
    }
  }

  if (requireReceiverEnvelope && targetReceiverStr && !hasReceiverEnvelope) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Key envelope for recipient is required.",
    );
  }

  return [...dedupeMap.values()];
};
