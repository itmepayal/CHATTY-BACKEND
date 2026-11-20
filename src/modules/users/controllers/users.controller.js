import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import ApiError from "../../../shared/errors/api-error.js";
import QRCode from "qrcode";
import * as userProfileService from "../services/user-profile.service.js";
import * as userRelationService from "../services/user-relation.service.js";
import * as userSettingsService from "../services/user-settings.service.js";
import * as userKeyService from "../services/user-key.service.js";
import * as userRepository from "../repositories/user.repository.js";
import * as contactRepo from "../../contacts/repositories/contact.repository.js";
import * as contactRequestRepo from "../../contacts/repositories/contact-request.repository.js";
import { isValidObjectId } from "../../../shared/utils/object-id.util.js";
import { clientUrl } from "../../../shared/constants/app.constants.js";

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

export const getBlockedUsers = asyncHandler(async (req, res) => {
  const list = await userRelationService.getBlockedUsers(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    list,
    "Blocked users retrieved.",
  ).send(res);
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
  const data = await userSettingsService.setPrivacy(req.user._id, req.body, {
    req,
    sessionId: req.sessionId,
  });

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

/**
 * Extracts a normalized username or user ID from multiple QR/link/payload formats:
 * - JSON string: {"type":"chatty_user","username":"itmepayal"}
 * - Custom protocol: chatty://user/:username, web+chatty://user/:username
 * - HTTPS / HTTP URL: https://chatty-app-sigma.vercel.app/user/:username
 * - Relative route: /user/:username, /u/:username, /profile/:username
 * - Direct identifier: @itmepayal, itmepayal, 24-char ObjectId
 */
export const extractUserIdentifierFromPayload = (payload) => {
  if (!payload) return null;
  if (typeof payload !== "string") {
    if (typeof payload === "object") {
      const idOrUser =
        payload.username || payload.id || payload._id || payload.identifier;
      return idOrUser ? String(idOrUser).replace(/^@/, "").trim() : null;
    }
    return null;
  }

  const str = payload.trim();
  if (!str) return null;

  // 1. JSON payload string
  if (str.startsWith("{")) {
    try {
      const parsed = JSON.parse(str);
      const found =
        parsed.username || parsed.id || parsed._id || parsed.identifier;
      if (found) return String(found).replace(/^@/, "").trim();
      if (parsed.shareUrl) {
        return extractUserIdentifierFromPayload(parsed.shareUrl);
      }
    } catch {}
  }

  // 2. Custom schemes: chatty://user/:username, web+chatty://...
  const schemeMatch = str.match(/^(?:web\+)?chatty:\/\/(.+)$/i);
  if (schemeMatch) {
    const pathAndQuery = schemeMatch[1].split("?")[0].split("#")[0];
    const segments = pathAndQuery.split("/").filter(Boolean);
    if (
      segments.length >= 2 &&
      ["user", "u", "profile"].includes(segments[0].toLowerCase())
    ) {
      return segments[1].replace(/^@/, "").trim();
    }
    if (segments.length >= 1) {
      return segments[0].replace(/^@/, "").trim();
    }
  }

  // 3. HTTP / HTTPS absolute URLs
  if (/^https?:\/\//i.test(str)) {
    try {
      const parsedUrl = new URL(str);
      const segments = parsedUrl.pathname.split("/").filter(Boolean);
      if (
        segments.length >= 2 &&
        ["user", "u", "profile"].includes(segments[0].toLowerCase())
      ) {
        return segments[1].replace(/^@/, "").trim();
      }
      if (
        segments.length === 1 &&
        !["login", "register", "chat", "settings", "landing"].includes(
          segments[0].toLowerCase(),
        )
      ) {
        return segments[0].replace(/^@/, "").trim();
      }
    } catch {}
  }

  // 4. Relative paths: /user/:username, /profile/:username, /u/:username
  if (str.startsWith("/")) {
    const pathOnly = str.split("?")[0].split("#")[0];
    const segments = pathOnly.split("/").filter(Boolean);
    if (
      segments.length >= 2 &&
      ["user", "u", "profile"].includes(segments[0].toLowerCase())
    ) {
      return segments[1].replace(/^@/, "").trim();
    }
    if (
      segments.length === 1 &&
      !["login", "register", "chat", "settings", "landing"].includes(
        segments[0].toLowerCase(),
      )
    ) {
      return segments[0].replace(/^@/, "").trim();
    }
  }

  // 5. Clean string / identifier (strip leading @, query parameters, trailing slashes)
  const clean = str
    .split("?")[0]
    .split("#")[0]
    .replace(/\/+$/, "")
    .replace(/^@/, "")
    .trim();

  if (clean && !clean.includes(" ") && !clean.includes("/")) {
    return clean;
  }

  return clean || null;
};

export const getUserQRCode = asyncHandler(async (req, res) => {
  const targetId = req.params.id || req.user._id;
  const { user } = await userProfileService.fetchUserProfileForViewer(
    targetId,
    req.user._id,
  );

  const baseUrl = (clientUrl || "http://localhost:5173").replace(/\/+$/, "");
  const identifier = user.username || String(user.id || user._id);
  const shareUrl = `${baseUrl}/user/${encodeURIComponent(identifier)}`;
  const deepLink = `chatty://user/${encodeURIComponent(identifier)}`;

  // Encode the canonical HTTPS shareable URL so all camera apps and external scanners navigate cleanly
  const qrCode = await QRCode.toDataURL(shareUrl, {
    width: 320,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });

  return new ApiResponse(
    StatusCodes.OK,
    {
      qrCode,
      payload: shareUrl,
      shareUrl,
      deepLink,
      user,
    },
    "QR code generated successfully.",
  ).send(res);
});

export const resolveQRPayload = asyncHandler(async (req, res) => {
  const { payload } = req.body || {};
  if (!payload) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "QR payload is required.");
  }

  const targetIdentifier = extractUserIdentifierFromPayload(payload);
  if (!targetIdentifier) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Invalid QR code or profile link.",
    );
  }

  let targetUser = null;
  if (isValidObjectId(targetIdentifier)) {
    targetUser = await userRepository.findById(targetIdentifier);
  }
  if (!targetUser) {
    targetUser = await userRepository.findByUsername(
      targetIdentifier.toLowerCase(),
    );
  }
  if (!targetUser) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User from QR code not found.");
  }

  const { user: safeUser } = await userProfileService.fetchUserProfileForViewer(
    targetUser._id,
    req.user._id,
  );

  const [isContact, isBlocked] = await Promise.all([
    contactRepo.existsContact(req.user._id, targetUser._id),
    contactRepo.isBlockedBidirectional(req.user._id, targetUser._id),
  ]);

  const activeRequest = await contactRequestRepo.findActiveRequestBetween(
    req.user._id,
    targetUser._id,
  );

  let relationship = "none";
  if (isBlocked) relationship = "blocked";
  else if (isContact) relationship = "connected";
  else if (activeRequest) {
    relationship =
      String(activeRequest.senderId) === String(req.user._id)
        ? "request_sent"
        : "incoming_request";
  }

  const mutualCount = (
    await contactRepo.findMutualContactIds(req.user._id, targetUser._id)
  ).length;

  const baseUrl = (clientUrl || "http://localhost:5173").replace(/\/+$/, "");
  const userIdentifier =
    safeUser.username || String(safeUser.id || safeUser._id);

  return new ApiResponse(
    StatusCodes.OK,
    {
      user: safeUser,
      relationship,
      requestId: activeRequest ? String(activeRequest._id) : null,
      mutualCount,
      shareUrl: `${baseUrl}/user/${encodeURIComponent(userIdentifier)}`,
      deepLink: `chatty://user/${encodeURIComponent(userIdentifier)}`,
    },
    "QR profile resolved successfully.",
  ).send(res);
});

const usersController = {
  updateProfile,
  updateAvatar,
  deleteAvatar,
  getCurrentUser,
  getUserProfile,
  getUserQRCode,
  resolveQRPayload,
  extractUserIdentifierFromPayload,
  getBlockedUsers,
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
