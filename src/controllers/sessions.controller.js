import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { StatusCodes } from "http-status-codes";
import {
  listUserSessions,
  revokeUserSession,
  revokeOtherUserSessions,
} from "../services/session.service.js";

const sessionController = {
  listSessions: asyncHandler(async (req, res) => {
    const sessions = await listUserSessions({
      userId: req.user._id,
      currentSessionId: req.sessionId,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { sessions },
      "Sessions retrieved.",
    ).send(res);
  }),

  revokeSession: asyncHandler(async (req, res) => {
    const { sessionId } = req.params;

    await revokeUserSession({ userId: req.user._id, sessionId });

    return new ApiResponse(
      StatusCodes.OK,
      null,
      "Session revoked successfully.",
    ).send(res);
  }),

  revokeOtherSessions: asyncHandler(async (req, res) => {
    const { revokedCount } = await revokeOtherUserSessions({
      userId: req.user._id,
      currentSessionId: req.sessionId,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { revokedCount },
      `Signed out of ${revokedCount} other session${revokedCount !== 1 ? "s" : ""}.`,
    ).send(res);
  }),
};

export default sessionController;
