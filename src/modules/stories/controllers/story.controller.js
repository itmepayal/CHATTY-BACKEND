import { StatusCodes } from "http-status-codes";
import * as storyService from "../services/story.service.js";
import ApiResponse from "../../../shared/responses/api-response.js";

/**
 * POST /api/v1/stories
 * Create a new story.
 */
export const createStory = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      mediaType,
      textContent,
      caption,
      textAlignment,
      textSize,
      overlays,
      background,
      privacy,
      allowedViewers,
      excludedViewers,
      duration,
    } = req.body;

    const story = await storyService.createStory({
      userId,
      mediaType,
      file: req.file,
      textContent,
      caption,
      textAlignment,
      textSize,
      overlays,
      background,
      privacy,
      allowedViewers,
      excludedViewers,
      duration,
    });

    return res
      .status(StatusCodes.CREATED)
      .json(new ApiResponse(StatusCodes.CREATED, story, "Story created successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/stories/feed
 * Retrieve current user's story feed.
 */
export const getStoryFeed = async (req, res, next) => {
  try {
    const viewerId = req.user._id;
    const feed = await storyService.getStoryFeed(viewerId);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, feed, "Story feed fetched successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/stories/user/:userId
 * Retrieve active stories for a specific user.
 */
export const getUserStories = async (req, res, next) => {
  try {
    const viewerId = req.user._id;
    const targetUserId = req.params.userId;
    const stories = await storyService.getUserStories(targetUserId, viewerId);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, stories, "User stories fetched successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stories/:storyId/view
 * Mark a story as viewed.
 */
export const recordStoryView = async (req, res, next) => {
  try {
    const viewerId = req.user._id;
    const { storyId } = req.params;
    const result = await storyService.recordStoryView(storyId, viewerId);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, result, "Story view recorded."));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stories/:storyId/react
 * React to a story with an emoji.
 */
export const reactToStory = async (req, res, next) => {
  try {
    const viewerId = req.user._id;
    const { storyId } = req.params;
    const { emoji } = req.body;
    const result = await storyService.reactToStory(storyId, viewerId, emoji);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, result, "Story reaction recorded."));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/stories/:storyId/reply
 * Reply to a story via direct chat message.
 */
export const replyToStory = async (req, res, next) => {
  try {
    const senderId = req.user._id;
    const { storyId } = req.params;
    const { text } = req.body;
    const result = await storyService.replyToStory(storyId, senderId, text);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, result, "Story reply sent successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/v1/stories/:storyId
 * Delete a story (owner only).
 */
export const deleteStory = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { storyId } = req.params;
    const result = await storyService.deleteStory(storyId, userId);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, result, "Story deleted successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/stories/:storyId/viewers
 * Get viewers list for a story (owner only) with pagination.
 */
export const getStoryViewers = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { storyId } = req.params;
    const { page, limit } = req.query;
    const result = await storyService.getStoryViewers(storyId, userId, {
      page,
      limit,
    });
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, result, "Story viewers fetched successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/stories/my
 * Retrieve active stories owned by the current user.
 */
export const getMyStories = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const stories = await storyService.getMyStories(userId);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, stories, "My stories fetched successfully."));
  } catch (err) {
    next(err);
  }
};
