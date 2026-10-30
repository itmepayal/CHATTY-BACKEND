import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { StatusCodes } from "http-status-codes";
import { requireUserId } from "../utils/request-helpers.js";
import {
  updateProfileData,
  updateUserAvatar,
  deleteUserAvatar,
  fetchCurrentUser,
} from "../services/user-profile.service.js";
import { applyRelation } from "../services/user-relation.service.js";
import {
  getPrivacy,
  setPrivacy,
  getChatPreferences,
  setChatPreferences,
  getAppearanceSettings,
  setAppearanceSettings,
} from "../services/user-settings.service.js";
import {
  savePublicKey,
  fetchUserPublicKey,
} from "../services/user-key.service.js";

const usersController = {
  updateProfile: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await updateProfileData(userId, req.body);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Profile updated successfully.",
    ).send(res);
  }),

  updateAvatar: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await updateUserAvatar(userId, req.file);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Avatar updated successfully.",
    ).send(res);
  }),

  deleteAvatar: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await deleteUserAvatar(userId);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Avatar removed successfully.",
    ).send(res);
  }),

  getCurrentUser: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await fetchCurrentUser(userId);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Current user fetched successfully.",
    ).send(res);
  }),

  blockUser: asyncHandler(async (req, res) => {
    const myId = requireUserId(req);
    const data = await applyRelation(myId, req.params.id, "blockedUsers", "add", "User blocked.");
    return new ApiResponse(StatusCodes.OK, data, "User blocked.").send(res);
  }),

  unblockUser: asyncHandler(async (req, res) => {
    const myId = requireUserId(req);
    const data = await applyRelation(myId, req.params.id, "blockedUsers", "remove", "User unblocked.");
    return new ApiResponse(StatusCodes.OK, data, "User unblocked.").send(res);
  }),

  addFavorite: asyncHandler(async (req, res) => {
    const myId = requireUserId(req);
    const data = await applyRelation(myId, req.params.id, "favorites", "add", "Added to favorites.");
    return new ApiResponse(StatusCodes.OK, data, "Added to favorites.").send(res);
  }),

  removeFavorite: asyncHandler(async (req, res) => {
    const myId = requireUserId(req);
    const data = await applyRelation(myId, req.params.id, "favorites", "remove", "Removed from favorites.");
    return new ApiResponse(StatusCodes.OK, data, "Removed from favorites.").send(res);
  }),

  getPrivacySettings: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await getPrivacy(userId);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Privacy settings fetched successfully.",
    ).send(res);
  }),

  updatePrivacySettings: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await setPrivacy(userId, req.body);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Privacy settings updated successfully.",
    ).send(res);
  }),

  getChatPrefs: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await getChatPreferences(userId);
    return new ApiResponse(StatusCodes.OK, data, "Chat preferences fetched.").send(res);
  }),

  updateChatPrefs: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await setChatPreferences(userId, req.body);
    return new ApiResponse(StatusCodes.OK, data, "Chat preferences updated.").send(res);
  }),

  getAppearance: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await getAppearanceSettings(userId);
    return new ApiResponse(StatusCodes.OK, data, "Appearance preferences fetched.").send(res);
  }),

  updateAppearance: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const data = await setAppearanceSettings(userId, req.body);
    return new ApiResponse(StatusCodes.OK, data, "Appearance preferences updated.").send(res);
  }),

  setMyPublicKey: asyncHandler(async (req, res) => {
    const userId = requireUserId(req);
    const result = await savePublicKey(userId, req.body);
    return new ApiResponse(
      StatusCodes.OK,
      {
        publicKey: result.publicKey,
        publicKeyUpdatedAt: result.publicKeyUpdatedAt,
      },
      "Public key saved.",
    ).send(res);
  }),

  getUserPublicKey: asyncHandler(async (req, res) => {
    requireUserId(req);
    const data = await fetchUserPublicKey(req.params.id);
    return new ApiResponse(StatusCodes.OK, data, "Public key fetched.").send(res);
  }),
};

export default usersController;
