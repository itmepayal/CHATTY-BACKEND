import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as userLockService from "../services/user-lock.service.js";

export const verifyLockPin = asyncHandler(async (req, res) => {
  const result = await userLockService.verifyLockPin({
    userId: req.user._id,
    pin: req.body.pin,
    chatId: req.body.chatId,
    scope: req.body.scope,
    sessionId: req.sessionId,
    ip: req.ip,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result,
    "PIN verified successfully.",
  ).send(res);
});

export const setupLockPin = asyncHandler(async (req, res) => {
  const result = await userLockService.setupLockPin({
    userId: req.user._id,
    pin: req.body.pin,
    timeout: req.body.timeout,
    sessionId: req.sessionId,
    ip: req.ip,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result,
    "App Lock PIN configured successfully.",
  ).send(res);
});

export const disableLockPin = asyncHandler(async (req, res) => {
  const unlockToken =
    req.header("X-Chat-Unlock-Token") ||
    req.header("x-chat-unlock-token") ||
    req.body.unlockToken;

  const result = await userLockService.disableLockPin({
    userId: req.user._id,
    pin: req.body.pin,
    password: req.body.password,
    unlockToken,
    ip: req.ip,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result,
    result.message || "App Lock disabled.",
  ).send(res);
});

const userLockController = {
  verifyLockPin,
  setupLockPin,
  disableLockPin,
};

export default userLockController;
