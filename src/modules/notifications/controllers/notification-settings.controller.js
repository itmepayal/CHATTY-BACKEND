import { StatusCodes } from "http-status-codes";
import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as notificationSettingsService from "../services/notification-settings.service.js";

export const getNotificationSettings = asyncHandler(async (req, res) => {
  const { settings, preferences } =
    await notificationSettingsService.getNotificationSettings(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    settings,
    "Notification settings fetched successfully.",
  ).send(res, { settings, preferences });
});

export const updateNotificationSettings = asyncHandler(async (req, res) => {
  const excludeSocketId =
    req.headers["x-socket-id"] || req.headers["x-client-socket-id"];

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

export const updateNotificationPreferences = asyncHandler(async (req, res) => {
  const excludeSocketId =
    req.headers["x-socket-id"] || req.headers["x-client-socket-id"];

  const preferences =
    await notificationSettingsService.updateNotificationPreferences(
      req.user._id,
      req.body,
      { excludeSocketId },
    );

  return new ApiResponse(
    StatusCodes.OK,
    preferences,
    "Notification preferences updated successfully.",
  ).send(res, { preferences });
});

export const muteChat = asyncHandler(async (req, res) => {
  const { targetId, type } = req.body;
  const preferences = await notificationSettingsService.muteChat(
    req.user._id,
    { targetId, type },
  );

  return new ApiResponse(
    StatusCodes.OK,
    preferences,
    "Chat notifications muted successfully.",
  ).send(res, { preferences });
});

export const unmuteChat = asyncHandler(async (req, res) => {
  const { targetId, type } = req.body;
  const preferences = await notificationSettingsService.unmuteChat(
    req.user._id,
    { targetId, type },
  );

  return new ApiResponse(
    StatusCodes.OK,
    preferences,
    "Chat notifications unmuted successfully.",
  ).send(res, { preferences });
});

export const savePushSubscription = asyncHandler(async (req, res) => {
  const result = await notificationSettingsService.savePushSubscription(
    req.user._id,
    req.body,
  );

  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Push subscription saved successfully.",
  ).send(res);
});

export const removePushSubscription = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  const result = await notificationSettingsService.removePushSubscription(
    req.user._id,
    endpoint,
  );

  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Push subscription removed successfully.",
  ).send(res);
});

export default {
  getNotificationSettings,
  updateNotificationSettings,
  updateNotificationPreferences,
  muteChat,
  unmuteChat,
  savePushSubscription,
  removePushSubscription,
};
