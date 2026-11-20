/**
 * User Relation Service
 * Manages relationships between users such as favorites and blocked users.
 */

import { StatusCodes } from "http-status-codes";
import * as userRepository from "../repositories/user.repository.js";
import ApiError from "../../../shared/errors/api-error.js";
import formatUser from "../utils/format-user.js";
import {
  isValidObjectId,
  toObjectId,
} from "../../../shared/utils/object-id.util.js";
import { io, refreshPrivacy } from "../../../infrastructure/socket/socket.js";
import * as contactRepo from "../../contacts/repositories/contact.repository.js";
import * as contactRequestRepo from "../../contacts/repositories/contact-request.repository.js";
import * as contactEvents from "../../contacts/events/contact.events.js";

export const getBlockedUsers = async (userId) => {
  const me = await userRepository.findByIdLeanSelect(userId, "blockedUsers");
  const blockedIds = (me?.blockedUsers || []).map(toObjectId);
  if (!blockedIds.length) return [];

  const list = await userRepository
    .find({ _id: { $in: blockedIds } }, "_id fullName username avatar email")
    .lean();

  return list.map((u) => ({
    id: String(u._id),
    _id: u._id,
    fullName: u.fullName,
    username: u.username || "",
    avatar: u.avatar?.url || (typeof u.avatar === "string" ? u.avatar : ""),
    email: u.email,
  }));
};

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

  const targetObjectId = toObjectId(targetId);

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
      ? { $addToSet: { [field]: targetObjectId } }
      : { $pull: { [field]: targetObjectId } };

  if (field === "blockedUsers" && action === "add") {
    update.$pull = { favorites: targetObjectId };
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
    if (action === "add") {
      try {
        await Promise.allSettled([
          contactRepo.deleteContact(myId, targetId),
          contactRepo.deleteContact(targetId, myId),
          contactRequestRepo.invalidateRequestsBetween(myId, targetId),
        ]);
        contactEvents.emitContactRemoved(myId, { contactId: String(targetId) });
        contactEvents.emitContactRemoved(targetId, { contactId: String(myId) });
        contactEvents.emitContactBlocked(myId, { userId: String(targetId) });
      } catch (e) {
        console.error("[user-relation] block cleanup error:", e?.message || e);
      }
    } else if (action === "remove") {
      try {
        contactEvents.emitContactUnblocked(myId, { userId: String(targetId) });
      } catch (e) {
        console.error("[user-relation] unblock emit error:", e?.message || e);
      }
    }

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
  getBlockedUsers,
};

export default userRelationService;
