import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import Call from "../models/call.model.js";
import ApiResponse from "../utils/api-response.js";

const callController = {
  getCallHistory: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const calls = await Call.find({
      $or: [{ callerId: userId }, { receiverId: userId }],
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("callerId receiverId", "fullName avatar");

    const data = calls.map((c) => {
      const outgoing = c.callerId._id.toString() === userId.toString();
      const other = outgoing ? c.receiverId : c.callerId;
      return {
        id: c._id,
        direction: outgoing ? "outgoing" : "incoming",
        type: c.type,
        status: c.status,
        duration: c.duration,
        startedAt: c.startedAt,
        user: {
          id: other._id,
          fullName: other.fullName,
          avatar: other.avatar?.url || "",
        },
      };
    });

    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Call history fetched successfully.",
    ).send(res);
  }),
};

export default callController;
