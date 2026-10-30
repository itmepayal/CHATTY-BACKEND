import mongoose from "mongoose";
import User from "../models/users.model.js";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import { io } from "../lib/socket.js";
import formatUser from "../utils/format-user.js";

export const applyRelation = async (myId, targetId, field, action, message) => {
  if (!mongoose.Types.ObjectId.isValid(targetId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }
  if (String(targetId) === String(myId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You can't do this to yourself.",
    );
  }
  if (!(await User.exists({ _id: targetId }))) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  if (field === "favorites" && action === "add") {
    const me = await User.findById(myId).select("blockedUsers");
    const isBlocked = me?.blockedUsers?.some(
      (b) => String(b) === String(targetId),
    );
    if (isBlocked) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Unblock this user before adding to favorites.",
      );
    }
  }

  const update =
    action === "add"
      ? { $addToSet: { [field]: targetId } }
      : { $pull: { [field]: targetId } };

  if (field === "blockedUsers" && action === "add") {
    update.$pull = { favorites: targetId };
  }

  const updatedUser = await User.findByIdAndUpdate(myId, update, {
    new: true,
  });

  if (!updatedUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  io.to(String(myId)).emit("relationsUpdated", {
    blockedUsers: (updatedUser.blockedUsers || []).map(String),
    favorites: (updatedUser.favorites || []).map(String),
  });

  return { user: formatUser(updatedUser) };
};
