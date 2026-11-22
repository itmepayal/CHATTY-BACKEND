import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import ApiError from "../../../shared/errors/api-error.js";
import * as callService from "../services/call.service.js";
import { translateCaption as translateCaptionService } from "../services/caption-translation.service.js";
import { io } from "../../../infrastructure/socket/socket.js";

export const getCallHistory = asyncHandler(async (req, res) => {
  const data = await callService.getCallHistoryList({
    userId: req.user._id,
    limit: req.query.limit,
    page: req.query.page,
    status: req.query.status,
    direction: req.query.direction,
    type: req.query.type,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Call history fetched successfully.",
  ).send(res);
});

export const markMissedCallsSeen = asyncHandler(async (req, res) => {
  const { callerId, callIds } = req.body || {};
  const data = await callService.markMissedCallsAsSeen({
    userId: req.user._id,
    callerId,
    callIds,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Missed calls marked as seen successfully.",
  ).send(res);
});

export const deleteCallHistoryItem = asyncHandler(async (req, res) => {
  const data = await callService.deleteCallHistoryItem(
    req.user._id,
    req.params.callId,
  );
  if (!data?.success) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Call record not found");
  }

  // Real-time synchronization across the authenticated user's own devices
  if (io && req.user?._id) {
    io.to(String(req.user._id)).emit("call:history:deleted", {
      callId: req.params.callId,
    });
  }

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Call history entry deleted successfully.",
  ).send(res);
});

export const bulkDeleteCallHistory = asyncHandler(async (req, res) => {
  const { callIds } = req.body || {};
  const data = await callService.bulkDeleteCallHistory(req.user._id, callIds);

  // Real-time synchronization across the authenticated user's own devices
  if (io && req.user?._id && Array.isArray(callIds) && callIds.length > 0) {
    io.to(String(req.user._id)).emit("call:history:bulk-deleted", {
      callIds,
      count: data.count,
    });
  }

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Selected call history entries deleted successfully.",
  ).send(res);
});

export const clearCallHistory = asyncHandler(async (req, res) => {
  const data = await callService.clearUserCallHistory(req.user._id);

  // Real-time synchronization across the authenticated user's own devices
  if (io && req.user?._id) {
    io.to(String(req.user._id)).emit("call:history:cleared");
  }

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Call history cleared successfully.",
  ).send(res);
});

export const getIceServers = asyncHandler(async (req, res) => {
  const data = callService.getIceServersConfig(req.user?._id);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "ICE servers fetched successfully.",
  ).send(res);
});

export const translateCaption = asyncHandler(async (req, res) => {
  const { text, sourceLang, targetLang } = req.body || {};
  if (!text || typeof text !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Text to translate is required.");
  }

  const result = await translateCaptionService(text, sourceLang, targetLang);
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Caption translated successfully.",
  ).send(res);
});

const callController = {
  getCallHistory,
  markMissedCallsSeen,
  deleteCallHistoryItem,
  bulkDeleteCallHistory,
  clearCallHistory,
  getIceServers,
  translateCaption,
};

export default callController;
