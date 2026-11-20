import { StatusCodes } from "http-status-codes";
import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../../../shared/responses/api-response.js";
import notificationService from "../services/notification.service.js";

export const getNotifications = asyncHandler(async (req, res) => {
  const result = await notificationService.getNotifications(
    req.user._id,
    req.query,
  );
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Notifications retrieved successfully.",
  ).send(res);
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const result = await notificationService.getUnreadCount(req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Unread count retrieved successfully.",
  ).send(res);
});

export const markAsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAsRead(
    req.user._id,
    req.params.id,
  );
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Notification marked as read.",
  ).send(res);
});

export const markAllAsRead = asyncHandler(async (req, res) => {
  const category = req.query.category || req.body?.category || null;
  const result = await notificationService.markAllAsRead(req.user._id, category);
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "All notifications marked as read.",
  ).send(res);
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const result = await notificationService.deleteNotification(
    req.user._id,
    req.params.id,
  );
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Notification deleted successfully.",
  ).send(res);
});

export const clearAllNotifications = asyncHandler(async (req, res) => {
  const category = req.query.category || req.body?.category || null;
  const result = await notificationService.clearAllNotifications(
    req.user._id,
    category,
  );
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Notifications cleared successfully.",
  ).send(res);
});

export default {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
};
