import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import GroupMessage from "../models/group-message.model.js";
import LocationShare from "../models/location-share.model.js";
import {
  LIVE_DURATIONS_MIN,
  MIN_LOCATION_UPDATE_INTERVAL_MS,
  GROUP_ERROR_MESSAGES,
} from "../constants/group.constants.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";
import { validCoords, readLocation } from "../utils/validators.js";
import { getBlockedByMe, getBlockersOf } from "../utils/group-guard.js";
import { canManageShare } from "../policies/group.policy.js";
import {
  lastUpdateAt,
  endShare,
  stopUserShares,
  broadcastGroupMessage,
  emitToViewers,
  formatGroupMessage,
  findGroupMessageDuplicate,
} from "./group.service.js";

const formatDuplicateShare = async (dup, mode) => {
  const message = formatGroupMessage(dup);
  if (mode === "live" && dup.location?.shareId) {
    const share = await LocationShare.findById(dup.location.shareId);
    return { message, share };
  }
  return message;
};

export const startGroupShareService = async ({ group, me, body }) => {
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
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_LOCATION,
    );
  }
  if (mode === "live" && !LIVE_DURATIONS_MIN.includes(durationMin)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid duration.");
  }

  const findDuplicate = () =>
    findGroupMessageDuplicate(group._id, me, clientId);

  if (clientId) {
    const dup = await findDuplicate();
    if (dup) {
      const data = await formatDuplicateShare(dup, mode);
      return { isDuplicate: true, mode, data };
    }
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
        if (dup) {
          const data = await formatDuplicateShare(dup, mode);
          return { isDuplicate: true, mode, data };
        }
      }
      throw error;
    }

    const payload = await broadcastGroupMessage(group, message, me);
    return { isDuplicate: false, mode: "current", data: payload };
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
      if (dup) {
        const data = await formatDuplicateShare(dup, mode);
        return { isDuplicate: true, mode, data };
      }
    }
    throw error;
  }

  share.messageId = message._id;
  await LocationShare.updateOne({ _id: share._id }, { messageId: message._id });

  const payload = await broadcastGroupMessage(group, message, me);

  await emitToViewers(group, me, GROUP_SOCKET_EVENTS.GROUP_LOCATION_UPDATE, {
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

  return {
    isDuplicate: false,
    mode: "live",
    data: { message: payload, share },
  };
};

export const updateGroupShareService = async ({ group, me, shareId, body }) => {
  if (!mongoose.Types.ObjectId.isValid(shareId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_SHARE_ID,
    );
  }

  const { lat, lng, accuracy, heading, speed } = readLocation(body);
  if (!validCoords(lat, lng)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_LOCATION,
    );
  }

  const key = String(shareId);
  const nowMs = Date.now();
  if (nowMs - (lastUpdateAt.get(key) || 0) < MIN_LOCATION_UPDATE_INTERVAL_MS) {
    return { skipped: true, shareId: key };
  }
  if (lastUpdateAt.size > 5000) lastUpdateAt.clear();
  lastUpdateAt.set(key, nowMs);

  const now = new Date();

  const existingShare = await LocationShare.findById(shareId);
  if (!existingShare || String(existingShare.groupId) !== String(group._id)) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.LIVE_SHARE_NOT_FOUND,
    );
  }

  canManageShare({
    share: existingShare,
    group,
    actorId: me,
    member: null,
    action: "update",
  });

  if (existingShare.status !== "active" || existingShare.expiresAt <= now) {
    lastUpdateAt.delete(key);
    await endShare(group, existingShare, "expired");
    throw new ApiError(
      StatusCodes.GONE,
      GROUP_ERROR_MESSAGES.LIVE_SHARE_EXPIRED,
    );
  }

  existingShare.lastLocation = {
    lat,
    lng,
    accuracy,
    heading,
    speed,
    updatedAt: now,
  };
  await existingShare.save();

  const locationPayload = {
    groupId: String(group._id),
    shareId: String(existingShare._id),
    sharerId: String(me),
    lat,
    lng,
    accuracy,
    heading,
    speed,
    updatedAt: now,
  };

  await emitToViewers(
    group,
    me,
    GROUP_SOCKET_EVENTS.GROUP_LOCATION_UPDATE,
    locationPayload,
  );

  return { skipped: false, locationPayload };
};

export const stopGroupShareService = async ({ group, member, me, shareId }) => {
  if (!mongoose.Types.ObjectId.isValid(shareId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_SHARE_ID,
    );
  }

  const share = await LocationShare.findById(shareId);
  if (!share || String(share.groupId) !== String(group._id)) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.LIVE_SHARE_NOT_FOUND,
    );
  }

  canManageShare({
    share,
    group,
    actorId: me,
    member,
    action: "stop",
  });

  if (share.status === "active") {
    await endShare(group, share, "stopped");
  }

  return { shareId: share._id };
};

export const getActiveGroupSharesService = async ({ group, me }) => {
  const now = new Date();
  const blocked = await getBlockedByMe(me);

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

export const startCurrentShare = startGroupShareService;
export const updateShare = updateGroupShareService;
export const stopShare = stopGroupShareService;
export const getActiveSharesFor = getActiveGroupSharesService;
export { formatGroupMessage };
