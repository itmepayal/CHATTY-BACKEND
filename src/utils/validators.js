import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "./api-error.js";

export const assertValidId = (id, label = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${label}.`);
  }
};

export const toNum = (v) =>
  v === null || v === undefined || v === "" ? NaN : Number(v);

export const optNum = (v) => {
  const n = toNum(v);
  return Number.isFinite(n) ? n : undefined;
};

export const validCoords = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

export const readLocation = (body) => ({
  lat: toNum(body.lat),
  lng: toNum(body.lng),
  accuracy: optNum(body.accuracy),
  heading: optNum(body.heading),
  speed: optNum(body.speed),
});

export const readClientId = (body) =>
  typeof body.clientId === "string" && body.clientId.length <= 64
    ? body.clientId
    : undefined;

export const parseIds = (raw) => {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = raw.split(",");
    }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const ids = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID in list.");
  }
  return ids;
};

export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const assertBooleanFields = (body, allowed, label) => {
  const unknownKeys = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknownKeys.length) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Unknown field(s): ${unknownKeys.join(", ")}`,
    );
  }

  const $set = {};
  for (const key of allowed) {
    if (key in body) {
      if (typeof body[key] !== "boolean") {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          `"${key}" must be a boolean.`,
        );
      }
      $set[key] = body[key];
    }
  }

  if (!Object.keys($set).length) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `No ${label} fields provided.`);
  }

  return $set;
};
