import { StatusCodes } from "http-status-codes";
import ApiError from "./api-error.js";

export const requireUserId = (req) => {
  const userId = req.user?._id;
  if (!userId) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
  }
  return userId;
};

export const myId = (req) => req.user._id || req.user.id;
