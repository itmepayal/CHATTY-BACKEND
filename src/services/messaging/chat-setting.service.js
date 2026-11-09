import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import User from "../../models/users.model.js";
import ChatSetting, {
  ALLOWED_TIMERS,
  pairKeyOf,
  getDisappearAfter,
} from "../../models/chat-setting.model.js";
import ChatArchive from "../../models/chat-archive.model.js";
import { assertValidId } from "../../utils/validators.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { io } from "../../lib/socket.js";

/**
 * Moved from messages.controller.js:L1097-1108
 */
export const getDisappearing = async (userId, otherId) => {
  assertValidId(otherId, "user ID");

  const seconds = await getDisappearAfter(userId, otherId);

  return { seconds };
};

/**
 * Moved from messages.controller.js:L1110-1150
 */
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

  await ChatSetting.findOneAndUpdate(
    { pairKey: pairKeyOf(userId, otherId) },
    { disappearAfter: seconds, updatedBy: userId },
    { upsert: true },
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

/**
 * Moved from messages.controller.js:L1152-1186
 */
export const setArchive = async (userId, otherId, rawArchived) => {
  const archived = rawArchived === true || rawArchived === "true";

  assertValidId(otherId, "user ID");

  if (otherId.toString() === userId.toString()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user.");
  }
  if (!(await User.exists({ _id: otherId }))) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  if (archived) {
    await ChatArchive.updateOne(
      { ownerId: userId, otherId },
      { $setOnInsert: { ownerId: userId, otherId } },
      { upsert: true },
    );
  } else {
    await ChatArchive.deleteOne({ ownerId: userId, otherId });
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
