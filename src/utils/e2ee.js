import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "./api-error.js";
import {
  MAX_CIPHERTEXT_LENGTH,
  MAX_WRAPPED_KEY_LENGTH,
  MAX_KEY_ENTRIES,
  AES_GCM_IV_BYTES,
  AES_GCM_TAG_BYTES,
  BASE64_ENCODING,
} from "../constants/constants.js";

const IV_BYTES = AES_GCM_IV_BYTES;
const GCM_TAG_BYTES = AES_GCM_TAG_BYTES;
const DECODE_ENC = BASE64_ENCODING;

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export {
  MAX_CIPHERTEXT_LENGTH,
  MAX_WRAPPED_KEY_LENGTH,
} from "../constants/constants.js";

export const parseBool = (v) => v === true || v === "true";

export const isBase64 = (v, { min = 1, max = Infinity } = {}) =>
  typeof v === "string" &&
  v.length >= min &&
  v.length <= max &&
  v.length % 4 === 0 &&
  B64_RE.test(v);

export const assertValidIv = (iv) => {
  if (
    !isBase64(iv, { min: 16, max: 16 }) ||
    Buffer.from(iv, DECODE_ENC).length !== IV_BYTES
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
    if (!isBase64(e?.wrappedKey, { min: 16, max: MAX_WRAPPED_KEY_LENGTH })) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid wrapped key.");
    }
    assertValidIv(e?.iv);

    map.set(`${userId}:${version}`, {
      userId,
      version,
      wrappedKey: e.wrappedKey,
      iv: e.iv,
    });
  }
  return [...map.values()];
};
