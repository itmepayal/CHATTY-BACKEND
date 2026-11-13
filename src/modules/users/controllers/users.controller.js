import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as userProfileService from "../services/user-profile.service.js";
import * as userRelationService from "../services/user-relation.service.js";
import * as userSettingsService from "../services/user-settings.service.js";
import * as userKeyService from "../services/user-key.service.js";

export const updateProfile = asyncHandler(async (req, res) => {
  const data = await userProfileService.updateProfileData(
    req.user._id,
    req.body,
  );

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Profile updated successfully.",
  ).send(res);
});

export const updateAvatar = asyncHandler(async (req, res) => {
  const data = await userProfileService.updateUserAvatar(
    req.user._id,
    req.file,
  );

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Avatar updated successfully.",
  ).send(res);
});

export const deleteAvatar = asyncHandler(async (req, res) => {
  const data = await userProfileService.deleteUserAvatar(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Avatar removed successfully.",
  ).send(res);
});

export const getCurrentUser = asyncHandler(async (req, res) => {
  const data = await userProfileService.fetchCurrentUser(req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Current user fetched successfully.",
  ).send(res);
});

export const getUserProfile = asyncHandler(async (req, res) => {
  const data = await userProfileService.fetchUserProfileForViewer(
    req.params.id,
    req.user._id,
  );

  return new ApiResponse(StatusCodes.OK, data, "User profile fetched.").send(
    res,
  );
});

export const blockUser = asyncHandler(async (req, res) => {
  const data = await userRelationService.applyRelation(
    req.user._id,
    req.params.id,
    "blockedUsers",
    "add",
    "User blocked.",
  );

  return new ApiResponse(StatusCodes.OK, data, "User blocked.").send(res);
});

export const unblockUser = asyncHandler(async (req, res) => {
  const data = await userRelationService.applyRelation(
    req.user._id,
    req.params.id,
    "blockedUsers",
    "remove",
    "User unblocked.",
  );

  return new ApiResponse(StatusCodes.OK, data, "User unblocked.").send(res);
});

export const addFavorite = asyncHandler(async (req, res) => {
  const data = await userRelationService.applyRelation(
    req.user._id,
    req.params.id,
    "favorites",
    "add",
    "Added to favorites.",
  );

  return new ApiResponse(StatusCodes.OK, data, "Added to favorites.").send(res);
});

export const removeFavorite = asyncHandler(async (req, res) => {
  const data = await userRelationService.applyRelation(
    req.user._id,
    req.params.id,
    "favorites",
    "remove",
    "Removed from favorites.",
  );

  return new ApiResponse(StatusCodes.OK, data, "Removed from favorites.").send(
    res,
  );
});

export const getPrivacySettings = asyncHandler(async (req, res) => {
  const data = await userSettingsService.getPrivacy(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Privacy settings fetched successfully.",
  ).send(res);
});

export const updatePrivacySettings = asyncHandler(async (req, res) => {
  const data = await userSettingsService.setPrivacy(req.user._id, req.body);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Privacy settings updated successfully.",
  ).send(res);
});

export const getChatPrefs = asyncHandler(async (req, res) => {
  const data = await userSettingsService.getChatPreferences(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Chat preferences fetched.",
  ).send(res);
});

export const updateChatPrefs = asyncHandler(async (req, res) => {
  const data = await userSettingsService.setChatPreferences(
    req.user._id,
    req.body,
  );

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Chat preferences updated.",
  ).send(res);
});

export const getAppearance = asyncHandler(async (req, res) => {
  const data = await userSettingsService.getAppearanceSettings(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Appearance preferences fetched.",
  ).send(res);
});

export const updateAppearance = asyncHandler(async (req, res) => {
  const data = await userSettingsService.setAppearanceSettings(
    req.user._id,
    req.body,
  );

  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Appearance preferences updated.",
  ).send(res);
});

export const setMyPublicKey = asyncHandler(async (req, res) => {
  const result = await userKeyService.savePublicKey(req.user._id, req.body);

  return new ApiResponse(
    StatusCodes.OK,
    {
      publicKey: result.publicKey,
      publicKeyUpdatedAt: result.publicKeyUpdatedAt,
    },
    "Public key saved.",
  ).send(res);
});

export const getUserPublicKey = asyncHandler(async (req, res) => {
  const data = await userKeyService.fetchUserPublicKey(req.params.id);

  return new ApiResponse(StatusCodes.OK, data, "Public key fetched.").send(res);
});

const usersController = {
  updateProfile,
  updateAvatar,
  deleteAvatar,
  getCurrentUser,
  getUserProfile,
  blockUser,
  unblockUser,
  addFavorite,
  removeFavorite,
  getPrivacySettings,
  updatePrivacySettings,
  getChatPrefs,
  updateChatPrefs,
  getAppearance,
  updateAppearance,
  setMyPublicKey,
  getUserPublicKey,
};

export default usersController;
