import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import GroupMessage from "../models/group-message.model.js";

import LocationShare from "../models/location-share.model.js";
import {
  LIVE_DURATIONS_MIN,
  MIN_LOCATION_UPDATE_INTERVAL_MS,
} from "../constants/constants.js";
import { validCoords, readLocation } from "../utils/validators.js";
import {
  lastUpdateAt,
  endShare,
  stopUserShares,
  broadcastGroupMessage,
  emitToViewers,
  formatGroupMessage,
  findGroupMessageDuplicate,
} from "./group.service.js";

export const startCurrentShare = async ({ group, me, body, file: _file }) => {
  const { mode } = body;
  const { lat, lng, accuracy, heading, speed } = readLocation(body);
  const durationMin =
    body.durationMin === null ||
    body.durationMin === undefined ||
    body.durationMin === ""
      ? NaN
      : Number(body.durationMin);
  const clientId =
    typeof body.clientId === "string" && body.clientId.length <= 64
      ? body.clientId
      : undefined;

  if (mode !== "current" && mode !== "live") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share mode.");
  }
  if (!validCoords(lat, lng)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid location.");
  }
  if (mode === "live" && !LIVE_DURATIONS_MIN.includes(durationMin)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid duration.");
  }

  const findDuplicate = () =>
    findGroupMessageDuplicate(group._id, me, clientId);

  if (clientId) {
    const dup = await findDuplicate();
    if (dup) return { duplicate: true, dup, mode };
  }

  if (mode === "current") {
    let message;
    try {
      message = await GroupMessage.create({
        groupId: group._id,
        senderId: me,
        location: { lat, lng, accuracy, isLive: false },
        clientId,
        readBy: [me],
      });
    } catch (error) {
      if (error?.code === 11000 && clientId) {
        const dup = await findDuplicate();
        if (dup) return { duplicate: true, dup, mode };
      }
      throw error;
    }

    const payload = await broadcastGroupMessage(group, message, me);
    return { mode: "current", payload };
  }

  await stopUserShares(group, me);

  const now = new Date();
  let share;
  try {
    share = await LocationShare.create({
      sharerId: me,
      groupId: group._id,
      expiresAt: new Date(now.getTime() + durationMin * 60_000),
      lastLocation: { lat, lng, accuracy, heading, speed, updatedAt: now },
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "A live share is already active in this group.",
      );
    }
    throw error;
  }

  let message;
  try {
    message = await GroupMessage.create({
      groupId: group._id,
      senderId: me,
      location: {
        lat,
        lng,
        accuracy,
        isLive: true,
        shareId: share._id,
      },
      clientId,
      readBy: [me],
    });
  } catch (error) {
    await LocationShare.deleteOne({ _id: share._id });

    if (error?.code === 11000 && clientId) {
      const dup = await findDuplicate();
      if (dup) return { duplicate: true, dup, mode };
    }
    throw error;
  }

  share.messageId = message._id;
  await LocationShare.updateOne({ _id: share._id }, { messageId: message._id });

  const payload = await broadcastGroupMessage(group, message, me);

  await emitToViewers(group, me, "group:location:update", {
    groupId: String(group._id),
    shareId: String(share._id),
    sharerId: String(me),
    lat,
    lng,
    accuracy,
    heading,
    speed,
    updatedAt: now,
  });

  return { mode: "live", payload, share };
};

export const updateShare = async ({ group, me, shareId, body }) => {
  if (!mongoose.Types.ObjectId.isValid(shareId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share ID.");
  }

  const { lat, lng, accuracy, heading, speed } = readLocation(body);

  if (!validCoords(lat, lng)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid location.");
  }

  const key = String(shareId);
  const nowMs = Date.now();
  if (nowMs - (lastUpdateAt.get(key) || 0) < MIN_LOCATION_UPDATE_INTERVAL_MS) {
    return { skipped: true, shareId: key };
  }
  if (lastUpdateAt.size > 5000) lastUpdateAt.clear();
  lastUpdateAt.set(key, nowMs);

  const now = new Date();

  const share = await LocationShare.findOneAndUpdate(
    {
      _id: shareId,
      groupId: group._id,
      sharerId: me,
      status: "active",
      expiresAt: { $gt: now },
    },
    {
      $set: {
        lastLocation: { lat, lng, accuracy, heading, speed, updatedAt: now },
      },
    },
    { new: true },
  );

  if (!share) {
    lastUpdateAt.delete(key);

    const stale = await LocationShare.findOne({
      _id: shareId,
      groupId: group._id,
      sharerId: me,
      status: "active",
      expiresAt: { $lte: now },
    });
    if (stale) {
      await endShare(group, stale, "expired");
      throw new ApiError(StatusCodes.GONE, "Live share has expired.");
    }
    throw new ApiError(StatusCodes.NOT_FOUND, "Live share not found.");
  }

  const locationPayload = {
    groupId: String(group._id),
    shareId: String(share._id),
    sharerId: String(me),
    lat,
    lng,
    accuracy,
    heading,
    speed,
    updatedAt: now,
  };

  await emitToViewers(group, me, "group:location:update", locationPayload);

  return { skipped: false, locationPayload };
};

export const stopShare = async ({ group, me, shareId }) => {
  if (!mongoose.Types.ObjectId.isValid(shareId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share ID.");
  }

  const share = await LocationShare.findOne({
    _id: shareId,
    groupId: group._id,
    sharerId: me,
    status: "active",
  });
  if (!share) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Live share not found.");
  }

  await endShare(group, share, "stopped");

  return { shareId: share._id };
};

export const getActiveSharesFor = async ({
  group,
  me,
  blocked,
  getBlockersOf,
}) => {
  const now = new Date();

  const stale = await LocationShare.find({
    groupId: group._id,
    status: "active",
    expiresAt: { $lte: now },
  });
  for (const s of stale) {
    await endShare(group, s, "expired");
  }

  const [mine, candidates] = await Promise.all([
    LocationShare.find({
      groupId: group._id,
      sharerId: me,
      status: "active",
      expiresAt: { $gt: now },
    }),
    LocationShare.find({
      groupId: group._id,
      sharerId: { $nin: [...blocked, me] },
      status: "active",
      expiresAt: { $gt: now },
    }),
  ]);

  const sharerIds = [...new Set(candidates.map((s) => String(s.sharerId)))];
  const blockedMe = sharerIds.length
    ? await getBlockersOf(sharerIds, me)
    : new Set();
  const inGroup = candidates.filter((s) => !blockedMe.has(String(s.sharerId)));

  return { mine, inGroup };
};

export { formatGroupMessage };
