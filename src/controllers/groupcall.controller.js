import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { getGroupAndMember } from "../utils/group-guard.js";
import {
  getGroupCallHistoryList,
  getMyGroupCallsList,
} from "../services/group-call.service.js";

const groupCallController = {
  getGroupCallHistory: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const data = await getGroupCallHistoryList({ group, member, me, limit });

    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Group call history fetched successfully.",
    ).send(res);
  }),

  getMyGroupCalls: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const data = await getMyGroupCallsList({ me, limit });

    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Group calls fetched successfully.",
    ).send(res);
  }),
};

export default groupCallController;
