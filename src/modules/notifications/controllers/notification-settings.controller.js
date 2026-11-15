import { StatusCodes } from "http-status-codes";
import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as notificationSettingsService from "../services/notification-settings.service.js";

export const getNotificationSettings = asyncHandler(async (req, res) => {
  const settings = await notificationSettingsService.getNotificationSettings(
    req.user._id,
  );

  return new ApiResponse(
    StatusCodes.OK,
    settings,
    "Notification settings fetched successfully.",
  ).send(res, { settings });
});

export const updateNotificationSettings = asyncHandler(async (req, res) => {
  const excludeSocketId = req.headers["x-socket-id"] || req.headers["x-client-socket-id"];

  const settings = await notificationSettingsService.updateNotificationSettings(
    req.user._id,
    req.body,
    { excludeSocketId },
  );

  return new ApiResponse(
    StatusCodes.OK,
    settings,
    "Notification settings updated successfully.",
  ).send(res, { settings });
});

export default {
  getNotificationSettings,
  updateNotificationSettings,
};
