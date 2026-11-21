import fs from "fs/promises";
import path from "path";
import { StatusCodes } from "http-status-codes";
import Story from "../models/story.model.js";
import User from "../../users/models/users.model.js";
import Contact from "../../contacts/models/contact.model.js";
import { canUserViewStory } from "./story-privacy.service.js";
import messageSendService from "../../messaging/services/sending/message-send.service.js";
import { uploadFileToCloudinary, deleteFileToCloudinary } from "../../../config/cloudinary.config.js";
import { io } from "../../../infrastructure/socket/socket.js";
import ApiError from "../../../shared/errors/api-error.js";

const sanitizeUser = (user) => {
  if (!user) return null;
  return {
    _id: String(user._id || user.id),
    fullName: user.fullName || "",
    username: user.username || "",
    avatar:
      user.avatar?.url ||
      (typeof user.avatar === "string" ? user.avatar : "") ||
      user.profilePic ||
      "",
  };
};

/**
 * Create a new 24-hour Story.
 */
export const createStory = async ({
  userId,
  mediaType = "text",
  file,
  textContent = "",
  caption = "",
  textAlignment = "center",
  textSize = "lg",
  overlays = [],
  background,
  privacy = "contacts",
  allowedViewers = [],
  excludedViewers = [],
  duration = 5,
}) => {
  if (!userId) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "User ID is required.");
  }

  let finalMediaType = mediaType;
  let mediaUrl = "";
  let mediaPublicId = "";
  let finalDuration = Number(duration) || 5;

  if (file) {
    const isVideo =
      file.mimetype?.startsWith("video/") ||
      /\.(mp4|webm|mov|mkv)$/i.test(file.originalname || "");
    finalMediaType = isVideo ? "video" : "image";
    finalDuration = isVideo ? (Number(duration) || 15) : 5;

    try {
      const uploadRes = await uploadFileToCloudinary(file.path);
      if (uploadRes && uploadRes.secure_url) {
        mediaUrl = uploadRes.secure_url;
        mediaPublicId = uploadRes.public_id || "";
      } else {
        // Fallback for local/test mode
        mediaUrl = `/upload/${path.basename(file.path)}`;
        mediaPublicId = `local_${Date.now()}`;
      }
    } catch (_err) {
      mediaUrl = `/upload/${path.basename(file.path)}`;
      mediaPublicId = `local_${Date.now()}`;
    }
  } else if (finalMediaType === "text") {
    if (!textContent || !textContent.trim()) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Text story content cannot be empty.");
    }
  } else {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Media file is required for image or video stories.");
  }

  let parsedBackground = {
    type: "gradient",
    value: "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
    textColor: "#FFFFFF",
    font: "sans",
  };

  if (background) {
    try {
      const bgObj = typeof background === "string" ? JSON.parse(background) : background;
      parsedBackground = {
        type: bgObj.type || parsedBackground.type,
        value: bgObj.value || parsedBackground.value,
        textColor: bgObj.textColor || parsedBackground.textColor,
        font: bgObj.font || parsedBackground.font,
      };
    } catch (_e) {
      // Keep defaults
    }
  }

  let parsedAllowed = [];
  if (allowedViewers) {
    try {
      parsedAllowed = typeof allowedViewers === "string" ? JSON.parse(allowedViewers) : allowedViewers;
    } catch (_e) {
      parsedAllowed = [];
    }
  }

  let parsedExcluded = [];
  if (excludedViewers) {
    try {
      parsedExcluded = typeof excludedViewers === "string" ? JSON.parse(excludedViewers) : excludedViewers;
    } catch (_e) {
      parsedExcluded = [];
    }
  }

  let parsedOverlays = [];
  if (overlays) {
    try {
      parsedOverlays = typeof overlays === "string" ? JSON.parse(overlays) : overlays;
    } catch (_e) {
      parsedOverlays = [];
    }
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const story = await Story.create({
    userId,
    mediaType: finalMediaType,
    mediaUrl,
    mediaPublicId,
    duration: finalDuration,
    textContent: textContent?.trim() || "",
    caption: caption?.trim() || "",
    textAlignment: ["left", "center", "right"].includes(textAlignment) ? textAlignment : "center",
    textSize: ["sm", "md", "lg", "xl"].includes(textSize) ? textSize : "lg",
    overlays: Array.isArray(parsedOverlays) ? parsedOverlays : [],
    background: parsedBackground,
    privacy,
    allowedViewers: parsedAllowed,
    excludedViewers: parsedExcluded,
    expiresAt,
  });

  const populatedStory = await Story.findById(story._id).populate(
    "userId",
    "fullName username avatar profilePic"
  );

  // Broadcast real-time event to socket (privacy-aware delivery)
  try {
    const storyData = {
      ...populatedStory.toObject(),
      userId: sanitizeUser(populatedStory.userId),
    };

    // Always emit to story owner's socket room
    io.to(String(userId)).emit("story:new", storyData);

    const currentUser = await User.findById(userId).select("blockedUsers");
    const blockedIds = new Set((currentUser?.blockedUsers || []).map(String));

    if (privacy === "everyone") {
      io.emit("story:new", storyData);
    } else if (privacy === "contacts") {
      const contacts = await Contact.find({ ownerId: userId }).select("contactId");
      for (const c of contacts) {
        const contactIdStr = String(c.contactId);
        if (!blockedIds.has(contactIdStr)) {
          io.to(contactIdStr).emit("story:new", storyData);
        }
      }
    } else if (privacy === "custom") {
      for (const viewerId of parsedAllowed) {
        const viewerIdStr = String(viewerId);
        if (!blockedIds.has(viewerIdStr)) {
          io.to(viewerIdStr).emit("story:new", storyData);
        }
      }
    } else if (privacy === "excluded") {
      const excludedSet = new Set(parsedExcluded.map(String));
      const contacts = await Contact.find({ ownerId: userId }).select("contactId");
      for (const c of contacts) {
        const contactIdStr = String(c.contactId);
        if (!excludedSet.has(contactIdStr) && !blockedIds.has(contactIdStr)) {
          io.to(contactIdStr).emit("story:new", storyData);
        }
      }
    }
  } catch (sockErr) {
    console.error("[story] socket emit story:new failed:", sockErr?.message || sockErr);
  }

  return populatedStory;
};

/**
 * Get active stories grouped by user for the viewer's feed.
 */
export const getStoryFeed = async (viewerId) => {
  const now = new Date();

  // Find active stories (expiresAt > now)
  const activeStories = await Story.find({
    expiresAt: { $gt: now },
  })
    .populate("userId", "fullName username avatar profilePic")
    .sort({ createdAt: 1 })
    .lean();

  // Filter stories the viewer is authorized to see
  const authorizedStories = [];
  for (const story of activeStories) {
    const canView = await canUserViewStory(story, viewerId);
    if (canView) {
      authorizedStories.push(story);
    }
  }

  // Group stories by user
  const userMap = new Map();

  for (const story of authorizedStories) {
    const ownerId = String(story.userId?._id || story.userId);
    const hasViewed = (story.views || []).some(
      (v) => String(v.userId) === String(viewerId)
    );

    if (!userMap.has(ownerId)) {
      userMap.set(ownerId, {
        user: sanitizeUser(story.userId),
        isSelf: ownerId === String(viewerId),
        stories: [],
        hasUnseen: false,
        latestStoryAt: story.createdAt,
      });
    }

    const group = userMap.get(ownerId);
    group.stories.push({
      ...story,
      userId: sanitizeUser(story.userId),
      hasViewed,
    });

    if (!hasViewed && ownerId !== String(viewerId)) {
      group.hasUnseen = true;
    }

    if (new Date(story.createdAt) > new Date(group.latestStoryAt)) {
      group.latestStoryAt = story.createdAt;
    }
  }

  const feedGroups = Array.from(userMap.values());

  // Sort feed:
  // 1. Own user first (if exists)
  // 2. Contacts with unseen stories (sorted by latestStoryAt desc)
  // 3. Contacts with fully seen stories (sorted by latestStoryAt desc)
  feedGroups.sort((a, b) => {
    if (a.isSelf) return -1;
    if (b.isSelf) return 1;
    if (a.hasUnseen && !b.hasUnseen) return -1;
    if (!a.hasUnseen && b.hasUnseen) return 1;
    return new Date(b.latestStoryAt).getTime() - new Date(a.latestStoryAt).getTime();
  });

  return feedGroups;
};

/**
 * Get active stories of a specific user.
 */
export const getUserStories = async (targetUserId, viewerId) => {
  const now = new Date();
  const stories = await Story.find({
    userId: targetUserId,
    expiresAt: { $gt: now },
  })
    .populate("userId", "fullName username avatar profilePic")
    .sort({ createdAt: 1 })
    .lean();

  const authorized = [];
  for (const story of stories) {
    const canView = await canUserViewStory(story, viewerId);
    if (canView) {
      const hasViewed = (story.views || []).some(
        (v) => String(v.userId) === String(viewerId)
      );
      authorized.push({
        ...story,
        userId: sanitizeUser(story.userId),
        hasViewed,
      });
    }
  }

  return authorized;
};

/**
 * Record a story view uniquely.
 */
export const recordStoryView = async (storyId, viewerId) => {
  const now = new Date();
  const story = await Story.findOne({
    _id: storyId,
    expiresAt: { $gt: now },
  });

  if (!story) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Story not found or expired.");
  }

  const canView = await canUserViewStory(story, viewerId);
  if (!canView) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to view this story.");
  }

  const ownerIdStr = String(story.userId);
  const viewerIdStr = String(viewerId);

  // If already viewed, return without duplicating
  const existingView = story.views.find(
    (v) => String(v.userId) === viewerIdStr
  );

  if (existingView) {
    return { success: true, alreadyViewed: true, viewCount: story.views.length };
  }

  // Atomically push view
  const updatedStory = await Story.findByIdAndUpdate(
    storyId,
    {
      $push: { views: { userId: viewerId, viewedAt: new Date() } },
      $inc: { viewCount: 1 },
    },
    { new: true }
  ).populate("views.userId", "fullName username avatar profilePic");

  // Real-time socket notification to story owner
  try {
    const viewerUser = await User.findById(viewerId).select("fullName username avatar profilePic");
    io.to(ownerIdStr).emit("story:viewed", {
      storyId: String(storyId),
      viewer: sanitizeUser(viewerUser),
      viewedAt: new Date(),
      viewCount: updatedStory.viewCount,
    });
  } catch (err) {
    console.error("[story] emit story:viewed failed:", err?.message || err);
  }

  return { success: true, alreadyViewed: false, viewCount: updatedStory.viewCount };
};

/**
 * React to a story with an emoji.
 */
export const reactToStory = async (storyId, viewerId, emoji) => {
  if (!emoji || typeof emoji !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Reaction emoji is required.");
  }

  const now = new Date();
  const story = await Story.findOne({
    _id: storyId,
    expiresAt: { $gt: now },
  });

  if (!story) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Story not found or expired.");
  }

  const canView = await canUserViewStory(story, viewerId);
  if (!canView) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to react to this story.");
  }

  const ownerIdStr = String(story.userId);
  const viewerIdStr = String(viewerId);

  // Check if view entry already exists
  const viewIndex = story.views.findIndex(
    (v) => String(v.userId) === viewerIdStr
  );

  if (viewIndex >= 0) {
    story.views[viewIndex].reaction = emoji;
    story.views[viewIndex].reactedAt = new Date();
  } else {
    story.views.push({
      userId: viewerId,
      viewedAt: new Date(),
      reaction: emoji,
      reactedAt: new Date(),
    });
    story.viewCount = story.views.length;
  }

  await story.save();

  // Real-time socket notification to story owner
  try {
    const viewerUser = await User.findById(viewerId).select("fullName username avatar profilePic");
    io.to(ownerIdStr).emit("story:reaction", {
      storyId: String(storyId),
      viewer: sanitizeUser(viewerUser),
      emoji,
      reactedAt: new Date(),
    });
  } catch (err) {
    console.error("[story] emit story:reaction failed:", err?.message || err);
  }

  return { success: true, emoji, storyId };
};

/**
 * Reply to a story. Directly integrates into the 1:1 chat conversation with story owner!
 */
export const replyToStory = async (storyId, senderId, text) => {
  if (!text || !text.trim()) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Reply message cannot be empty.");
  }

  const now = new Date();
  const story = await Story.findOne({
    _id: storyId,
    expiresAt: { $gt: now },
  });

  if (!story) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Story not found or expired.");
  }

  const canView = await canUserViewStory(story, senderId);
  if (!canView) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You are not authorized to reply to this story.");
  }

  const ownerId = story.userId;

  if (String(ownerId) === String(senderId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You cannot reply to your own story.");
  }

  const storyReplyPayload = {
    storyId: story._id,
    storyOwnerId: ownerId,
    storyMediaType: story.mediaType,
    storyPreviewUrl: story.mediaUrl || story.thumbnailUrl || "",
    storyCaption: story.caption || "",
    storyTextContent: story.textContent || "",
  };

  // Send message through regular 1:1 DM messaging engine
  const result = await messageSendService.sendMessage(
    senderId,
    ownerId,
    {
      text: text.trim(),
      storyReply: storyReplyPayload,
      messageType: "story_reply",
    }
  );

  // Also record a view if not already recorded
  await recordStoryView(storyId, senderId).catch(() => {});

  return result;
};

/**
 * Delete a story (owner only). Cleans up Cloudinary asset if present.
 */
export const deleteStory = async (storyId, userId) => {
  const story = await Story.findById(storyId);

  if (!story) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Story not found.");
  }

  if (String(story.userId) !== String(userId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You can only delete your own stories.");
  }

  // Clean up Cloudinary asset if available
  if (story.mediaPublicId && !story.mediaPublicId.startsWith("local_")) {
    try {
      await deleteFileToCloudinary(
        story.mediaPublicId,
        story.mediaType === "video" ? "video" : "image"
      );
    } catch (err) {
      console.error("[story] failed to delete asset from Cloudinary:", err?.message || err);
    }
  }

  await Story.findByIdAndDelete(storyId);

  // Emit real-time deletion event
  try {
    io.emit("story:deleted", {
      storyId: String(storyId),
      userId: String(userId),
    });
  } catch (sockErr) {
    console.error("[story] emit story:deleted failed:", sockErr?.message || sockErr);
  }

  return { success: true, message: "Story deleted successfully." };
};

/**
 * Get viewers list for a story (story owner only) with pagination.
 */
export const getStoryViewers = async (
  storyId,
  userId,
  { page = 1, limit = 50 } = {}
) => {
  const story = await Story.findById(storyId).populate(
    "views.userId",
    "fullName username avatar profilePic"
  );

  if (!story) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Story not found.");
  }

  if (String(story.userId) !== String(userId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Only the story owner can view the viewers list."
    );
  }

  const viewers = (story.views || []).map((v) => ({
    user: sanitizeUser(v.userId),
    viewedAt: v.viewedAt,
    reaction: v.reaction || null,
    reactedAt: v.reactedAt || null,
  }));

  // Reverse so newest viewers appear first
  viewers.reverse();

  const numPage = Math.max(1, parseInt(page, 10) || 1);
  const numLimit = Math.max(1, parseInt(limit, 10) || 50);
  const startIndex = (numPage - 1) * numLimit;
  const paginatedViewers = viewers.slice(startIndex, startIndex + numLimit);

  return {
    storyId: String(story._id),
    totalViews: viewers.length,
    page: numPage,
    limit: numLimit,
    hasMore: viewers.length > startIndex + numLimit,
    viewers: paginatedViewers,
  };
};

/**
 * Get current user's active stories with remaining lifetime and analytics.
 */
export const getMyStories = async (userId) => {
  const now = new Date();
  const stories = await Story.find({
    userId,
    expiresAt: { $gt: now },
  })
    .sort({ createdAt: -1 })
    .lean();

  return stories.map((story) => {
    const remainingMs = Math.max(0, new Date(story.expiresAt).getTime() - Date.now());
    const remainingHours = Math.floor(remainingMs / (1000 * 60 * 60));
    const remainingMinutes = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

    // Calculate reaction breakdown
    const reactionCounts = {};
    for (const v of story.views || []) {
      if (v.reaction) {
        reactionCounts[v.reaction] = (reactionCounts[v.reaction] || 0) + 1;
      }
    }

    return {
      ...story,
      viewCount: story.views?.length || 0,
      uniqueViewers: story.views?.length || 0,
      reactionCounts,
      remainingMs,
      remainingFormatted: `${remainingHours}h ${remainingMinutes}m`,
    };
  });
};

const storyService = {
  createStory,
  getStoryFeed,
  getUserStories,
  getMyStories,
  recordStoryView,
  reactToStory,
  replyToStory,
  deleteStory,
  getStoryViewers,
};

export default storyService;
