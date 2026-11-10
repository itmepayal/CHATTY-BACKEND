import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import { isValidObjectId } from "../../utils/object-id.util.js";
import * as groupMessageRepository from "../../repositories/groups/group-message.repository.js";
import * as locationShareRepository from "../../repositories/messaging/location-share.repository.js";
import {
  LIVE_DURATIONS_MIN,
  MIN_LOCATION_UPDATE_INTERVAL_MS,
  GROUP_ERROR_MESSAGES,
} from "../../constants/group/index.js";
import { GROUP_SOCKET_EVENTS } from "../../constants/group/group-events.constants.js";
import { validCoords, readLocation } from "../../utils/validators.js";
import { getBlockedByMe, getBlockersOf, getGroupAndMember } from "../../utils/group-guard.js";
import { canManageShare } from "../../policies/group.policy.js";
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
    const share = await locationShareRepository.findById(dup.location.shareId);
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
      message = await groupMessageRepository.create({
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
    share = await locationShareRepository.create({
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
    message = await groupMessageRepository.create({
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
    await locationShareRepository.deleteOne({ _id: share._id });
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
  await locationShareRepository.updateOne({ _id: share._id }, { messageId: message._id });

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
  if (!isValidObjectId(shareId)) {
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

  const existingShare = await locationShareRepository.findById(shareId);
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

  const key = String(shareId);
  const nowMs = Date.now();
  if (nowMs - (lastUpdateAt.get(key) || 0) < MIN_LOCATION_UPDATE_INTERVAL_MS) {
    return { skipped: true, shareId: key };
  }
  if (lastUpdateAt.size > 5000) lastUpdateAt.clear();
  lastUpdateAt.set(key, nowMs);

  const now = new Date();

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
  if (!isValidObjectId(shareId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_SHARE_ID,
    );
  }

  const share = await locationShareRepository.findById(shareId);
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

  const stale = await locationShareRepository.find({
    groupId: group._id,
    status: "active",
    expiresAt: { $lte: now },
  });
  for (const s of stale) {
    await endShare(group, s, "expired");
  }

  const [mine, candidates] = await Promise.all([
    locationShareRepository.find({
      groupId: group._id,
      sharerId: me,
      status: "active",
      expiresAt: { $gt: now },
    }),
    locationShareRepository.find({
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

export const startGroupShareForRequest = async ({ groupId, me, body }) => {
  const { group } = await getGroupAndMember(groupId, me);
  return startGroupShareService({ group, me, body });
};

export const updateGroupShareForRequest = async ({
  groupId,
  me,
  shareId,
  body,
}) => {
  const { group } = await getGroupAndMember(groupId, me);
  return updateGroupShareService({ group, me, shareId, body });
};

export const stopGroupShareForRequest = async ({ groupId, me, shareId }) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  return stopGroupShareService({ group, member, me, shareId });
};

export const getActiveGroupSharesForRequest = async ({ groupId, me }) => {
  const { group } = await getGroupAndMember(groupId, me);
  return getActiveGroupSharesService({ group, me });
};

export const startCurrentShare = startGroupShareService;
export const updateShare = updateGroupShareService;
export const stopShare = stopGroupShareService;
export const getActiveSharesFor = getActiveGroupSharesService;
export { formatGroupMessage };

const groupShareService = {
  startGroupShareService,
  updateGroupShareService,
  stopGroupShareService,
  getActiveGroupSharesService,
  startGroupShareForRequest,
  updateGroupShareForRequest,
  stopGroupShareForRequest,
  getActiveGroupSharesForRequest,
  startCurrentShare,
  updateShare,
  stopShare,
  getActiveSharesFor,
  formatGroupMessage,
};

export default groupShareService;

