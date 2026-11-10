import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as sessionService from "../services/session.service.js";

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await sessionService.listUserSessions({
    userId: req.user._id,
    currentSessionId: req.sessionId,
  });

  return new ApiResponse(
    StatusCodes.OK,
    { sessions },
    "Sessions retrieved.",
  ).send(res);
});

export const revokeSession = asyncHandler(async (req, res) => {
  await sessionService.revokeUserSession({
    userId: req.user._id,
    sessionId: req.params.sessionId,
  });

  return new ApiResponse(
    StatusCodes.OK,
    null,
    "Session revoked successfully.",
  ).send(res);
});

export const revokeOtherSessions = asyncHandler(async (req, res) => {
  const { revokedCount } = await sessionService.revokeOtherUserSessions({
    userId: req.user._id,
    currentSessionId: req.sessionId,
  });

  return new ApiResponse(
    StatusCodes.OK,
    { revokedCount },
    `Signed out of ${revokedCount} other session${revokedCount !== 1 ? "s" : ""}.`,
  ).send(res);
});

const sessionController = {
  listSessions,
  revokeSession,
  revokeOtherSessions,
};

export default sessionController;
