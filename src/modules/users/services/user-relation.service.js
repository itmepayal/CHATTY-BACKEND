/**
 * User Relation Service
 * Manages relationships between users such as favorites and blocked users.
 */

import { StatusCodes } from "http-status-codes";
import * as userRepository from "../repositories/user.repository.js";
import ApiError from "../../../shared/errors/api-error.js";
import formatUser from "../utils/format-user.js";
import { isValidObjectId } from "../../../shared/utils/object-id.util.js";
import { io, refreshPrivacy } from "../../../infrastructure/socket/socket.js";

export const applyRelation = async (myId, targetId, field, action, message) => {
  if (!isValidObjectId(targetId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }
  if (String(targetId) === String(myId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You can't do this to yourself.",
    );
  }
  if (!(await userRepository.existsById(targetId))) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  if (field === "favorites" && action === "add") {
    const me = await userRepository.findById(myId).select("blockedUsers");
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

  const updatedUser = await userRepository.findByIdAndUpdate(myId, update, {
    new: true,
  });

  if (!updatedUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  io.to(String(myId)).emit("relationsUpdated", {
    blockedUsers: (updatedUser.blockedUsers || []).map(String),
    favorites: (updatedUser.favorites || []).map(String),
  });

  if (field === "blockedUsers") {
    try {
      await refreshPrivacy(myId);
      await refreshPrivacy(targetId);
    } catch (e) {
      console.error("[user-relation] refreshPrivacy error:", e?.message || e);
    }
  }

  return { user: formatUser(updatedUser) };
};

const userRelationService = {
  applyRelation,
};

export default userRelationService;
