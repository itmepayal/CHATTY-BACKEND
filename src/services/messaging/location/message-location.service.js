import { StatusCodes } from "http-status-codes";
import ApiError from "../../../utils/api-error.js";
import * as messageRepository from "../../../repositories/messaging/message.repository.js";
import * as locationShareRepository from "../../../repositories/messaging/location-share.repository.js";
import { LIVE_DURATIONS_MIN } from "../../../constants/messaging/messages.constants.js";
import { assertValidId, toNum, validCoords } from "../../../utils/validators.js";
import { assertCanMessage } from "../../../utils/chat-guard.js";
import { deliverMessage } from "../core/message.service.js";
import { emitToPair } from "../../../utils/message-helpers.js";

export const startShare = async (
  senderId,
  {
    receiverId,
    mode,
    lat: rawLat,
    lng: rawLng,
    accuracy: rawAccuracy,
    durationMin: rawDurationMin,
  } = {},
) => {
  const lat = toNum(rawLat);
  const lng = toNum(rawLng);
  const accuracy = toNum(rawAccuracy);
  const durationMin = toNum(rawDurationMin);

  assertValidId(receiverId, "receiver ID");

  if (receiverId.toString() === senderId.toString()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot share location with yourself.",
    );
  }
  if (mode !== "current" && mode !== "live") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid share mode.");
  }
  if (!validCoords(lat, lng)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid location.");
  }

  await assertCanMessage(senderId, receiverId);

  const safeAccuracy = Number.isFinite(accuracy) ? accuracy : undefined;

  if (mode === "current") {
    const { payload } = await deliverMessage({
      senderId,
      receiverId,
      data: {
        location: { lat, lng, accuracy: safeAccuracy, isLive: false },
      },
    });

    return {
      status: StatusCodes.CREATED,
      data: payload,
      message: "Location sent.",
    };
  }

  if (!LIVE_DURATIONS_MIN.includes(durationMin)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid duration.");
  }

  const previous = await locationShareRepository.find({
    sharerId: senderId,
    receiverId,
    status: "active",
  });
  const oldShareIds = previous.map((p) => p._id);
  for (const old of previous) {
    old.status = "stopped";
    old.endedAt = new Date();
    await old.save();
    emitToPair(old.sharerId, old.receiverId, "location:ended", {
      shareId: String(old._id),
    });
  }
  if (oldShareIds.length) {
    await messageRepository.updateMany(
      { "location.shareId": { $in: oldShareIds } },
      { "location.isLive": false },
    );
  }

  const now = new Date();
  const share = await locationShareRepository.create({
    sharerId: senderId,
    receiverId,
    expiresAt: new Date(now.getTime() + durationMin * 60_000),
    lastLocation: { lat, lng, accuracy: safeAccuracy, updatedAt: now },
  });

  let result;
  try {
    result = await deliverMessage({
      senderId,
      receiverId,
      data: {
        location: {
          lat,
          lng,
          accuracy: safeAccuracy,
          isLive: true,
          shareId: share._id,
        },
      },
    });
  } catch (error) {
    await locationShareRepository.deleteOne({ _id: share._id });
    throw error;
  }

  share.messageId = result.message._id;
  await share.save();

  emitToPair(senderId, receiverId, "location:update", {
    shareId: String(share._id),
    lat,
    lng,
    accuracy: safeAccuracy,
    updatedAt: now,
  });

  return {
    status: StatusCodes.CREATED,
    data: { message: result.payload, share },
    message: "Live location started.",
  };
};

export const stopShare = async (userId, shareId) => {
  assertValidId(shareId, "share ID");

  const share = await locationShareRepository.findOne({
    _id: shareId,
    sharerId: userId,
    status: "active",
  });
  if (!share) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Live share not found.");
  }

  share.status = "stopped";
  share.endedAt = new Date();
  await share.save();

  await messageRepository.updateOne(
    { "location.shareId": share._id },
    { "location.isLive": false },
  );

  emitToPair(share.sharerId, share.receiverId, "location:ended", {
    shareId: String(share._id),
  });

  return { shareId: share._id, message: "Live location stopped." };
};

export const getActiveShares = async (userId) => {
  const now = new Date();

  await locationShareRepository.updateMany(
    { status: "active", expiresAt: { $lte: now } },
    { status: "expired", endedAt: now },
  );

  const [mine, forMe] = await Promise.all([
    locationShareRepository.find({
      sharerId: userId,
      status: "active",
      expiresAt: { $gt: now },
    }),
    locationShareRepository.find({
      receiverId: userId,
      status: "active",
      expiresAt: { $gt: now },
    }),
  ]);

  return { mine, forMe, message: "Active location shares." };
};

const messageLocationService = {
  startShare,
  stopShare,
  getActiveShares,
};

export default messageLocationService;

