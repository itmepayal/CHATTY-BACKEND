import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import User from "../../models/users.model.js";
import Message from "../../models/message.model.js";
import Report from "../../models/report.model.js";
import { REPORT_REASONS } from "../../constants/messages.constants.js";
import { assertValidId } from "../../utils/validators.js";
import { isBetween } from "../../utils/message-helpers.js";

/**
 * Moved from messages.controller.js:L1028-1095
 */
export const reportUser = async (
  reporterId,
  reportedUserId,
  { reason, details, messageId } = {},
) => {
  assertValidId(reportedUserId, "user ID");

  if (reportedUserId.toString() === reporterId.toString()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You cannot report yourself.");
  }
  if (!REPORT_REASONS.includes(reason)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Please choose a valid reason.",
    );
  }
  if (details && String(details).trim().length > 500) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Details cannot exceed 500 characters.",
    );
  }

  const reported = await User.exists({ _id: reportedUserId });
  if (!reported) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  if (messageId) {
    assertValidId(messageId, "message ID");
    const m = await Message.findById(messageId).select("senderId receiverId");
    if (!m || !isBetween(m, reporterId, reportedUserId)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Invalid message for report.",
      );
    }
  }

  const recent = await Report.exists({
    reporterId,
    reportedUserId,
    createdAt: { $gt: new Date(Date.now() - 24 * 3600_000) },
  });
  if (recent) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "You already reported this user in the last 24 hours.",
    );
  }

  await Report.create({
    reporterId,
    reportedUserId,
    messageId: messageId || undefined,
    reason,
    details: details ? String(details).trim() : undefined,
  });

  return { message: "Report submitted. Thank you." };
};
