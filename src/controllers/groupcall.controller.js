import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../utils/api-response.js";
import * as groupCallService from "../services/calls/group-call.service.js";

export const getGroupCallHistory = asyncHandler(async (req, res) => {
  const data = await groupCallService.getGroupCallHistoryForRequest({
    groupId: req.params.id,
    me: req.user._id,
    limit: req.query.limit,
    page: req.query.page,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Group call history fetched successfully.",
  ).send(res);
});

export const getMyGroupCalls = asyncHandler(async (req, res) => {
  const data = await groupCallService.getMyGroupCallsList({
    me: req.user._id,
    limit: req.query.limit,
    page: req.query.page,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Group calls fetched successfully.",
  ).send(res);
});

const groupCallController = {
  getGroupCallHistory,
  getMyGroupCalls,
};

export default groupCallController;
