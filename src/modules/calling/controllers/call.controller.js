import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as callService from "../services/call.service.js";

export const getCallHistory = asyncHandler(async (req, res) => {
  const data = await callService.getCallHistoryList({
    userId: req.user._id,
    limit: req.query.limit,
    page: req.query.page,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Call history fetched successfully.",
  ).send(res);
});

const callController = {
  getCallHistory,
};

export default callController;
