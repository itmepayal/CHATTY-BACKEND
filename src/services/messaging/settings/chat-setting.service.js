/**
 * Chat Setting Service
 * Manages per-chat configuration including disappearing message timers and archiving.
 */

import { StatusCodes } from "http-status-codes";
import * as userRepository from "../../../repositories/users/user.repository.js";
import * as chatSettingRepository from "../../../repositories/messaging/chat-setting.repository.js";
import {
  ALLOWED_TIMERS,
  pairKeyOf,
  getDisappearAfter,
} from "../../../repositories/messaging/chat-setting.repository.js";
import { assertCanMessage } from "../../../utils/chat-guard.js";
import ApiError from "../../../utils/api-error.js";
import { assertValidId } from "../../../utils/validators.js";
import { io } from "../../../lib/socket.js";

export const getDisappearing = async (userId, otherId) => {
  assertValidId(otherId, "user ID");

  const seconds = await getDisappearAfter(userId, otherId);

  return { seconds };
};

export const setDisappearing = async (userId, otherId, rawSeconds) => {
  const seconds = Number(rawSeconds);

  assertValidId(otherId, "user ID");

  if (otherId.toString() === userId.toString()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user.");
  }
  if (!ALLOWED_TIMERS.includes(seconds)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid timer value.");
  }

  await assertCanMessage(userId, otherId);

  await chatSettingRepository.upsertDisappear(
    { pairKey: pairKeyOf(userId, otherId) },
    { disappearAfter: seconds, updatedBy: userId },
  );

  io.to(userId.toString()).emit("disappearingUpdated", {
    userId: otherId.toString(),
    seconds,
    by: userId,
  });
  io.to(otherId.toString()).emit("disappearingUpdated", {
    userId: userId.toString(),
    seconds,
    by: userId,
  });

  return {
    seconds,
    message: seconds
      ? "Disappearing messages turned on."
      : "Disappearing messages turned off.",
  };
};

export const setArchive = async (userId, otherId, rawArchived) => {
  const archived = rawArchived === true || rawArchived === "true";

  assertValidId(otherId, "user ID");

  if (otherId.toString() === userId.toString()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user.");
  }
  if (!(await userRepository.existsById(otherId))) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  if (archived) {
    await chatSettingRepository.archiveChat(userId, otherId);
  } else {
    await chatSettingRepository.unarchiveChat(userId, otherId);
  }

  io.to(userId.toString()).emit("chatArchived", {
    userId: otherId.toString(),
    archived,
  });

  return {
    userId: otherId,
    archived,
    message: archived ? "Chat archived." : "Chat unarchived.",
  };
};

const chatSettingService = {
  getDisappearing,
  setDisappearing,
  setArchive,
};

export default chatSettingService;
