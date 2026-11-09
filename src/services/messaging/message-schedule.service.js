import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import ScheduledMessage from "../../models/scheduled-message.model.js";
import { assertValidId } from "../../utils/validators.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { assertE2EEReady } from "../message.service.js";
import {
  parseBool,
  assertValidCipher,
  MAX_CIPHERTEXT_LENGTH,
} from "../../utils/e2ee.js";
import { MAX_TEXT_LENGTH } from "../../constants/messages.constants.js";

export const scheduleMessage = async (
  senderId,
  receiverId,
  { text: rawText, encrypted, e2ee, iv, scheduledFor } = {},
) => {
  const text = rawText?.trim();
  const wantsE2EE = parseBool(encrypted ?? e2ee);
  const when = new Date(scheduledFor);

  assertValidId(receiverId, "receiver ID");

  if (receiverId.toString() === senderId.toString()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You cannot message yourself.");
  }

  const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;
  if (!text || text.length > maxLen) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      wantsE2EE
        ? "Encrypted payload is invalid or too large."
        : `Text must be 1-${MAX_TEXT_LENGTH} characters.`,
    );
  }
  if (wantsE2EE) assertValidCipher(text, iv);

  if (
    Number.isNaN(when.getTime()) ||
    when.getTime() < Date.now() + 30_000 ||
    when.getTime() > Date.now() + 30 * 86_400_000
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Pick a time between 1 minute and 30 days from now.",
    );
  }

  await assertCanMessage(senderId, receiverId);
  if (wantsE2EE) await assertE2EEReady(senderId, receiverId);

  const doc = await ScheduledMessage.create({
    senderId,
    receiverId,
    text,
    scheduledFor: when,
    ...(wantsE2EE ? { e2ee: true, iv } : {}),
  });

  return { doc, message: "Message scheduled." };
};

export const getScheduled = async (userId, { to } = {}) => {
  const filter = { senderId: userId, status: "pending" };
  if (to && mongoose.Types.ObjectId.isValid(to)) {
    filter.receiverId = to;
  }

  const list = await ScheduledMessage.find(filter).sort({ scheduledFor: 1 });

  return { list, message: "Scheduled messages." };
};

export const cancelScheduled = async (userId, scheduleId) => {
  assertValidId(scheduleId, "schedule ID");

  const doc = await ScheduledMessage.findOneAndUpdate(
    { _id: scheduleId, senderId: userId, status: "pending" },
    { status: "cancelled" },
  );
  if (!doc) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Scheduled message not found.");
  }

  return { id: doc._id, message: "Scheduled message cancelled." };
};
