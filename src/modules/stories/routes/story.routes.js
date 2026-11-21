import express from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import upload, {
  enforceTypeSizeLimit,
  autoCleanupMulterOnFailure,
} from "../../../middlewares/multer.middleware.js";
import * as storyController from "../controllers/story.controller.js";

const router = express.Router();

router.use(authMiddleware);

// Story Feed & User Stories
router.get("/feed", storyController.getStoryFeed);
router.get("/my", storyController.getMyStories);
router.get("/user/:userId", storyController.getUserStories);

// Create new story (with optional media upload)
router.post(
  "/",
  upload.single("media"),
  autoCleanupMulterOnFailure,
  enforceTypeSizeLimit,
  storyController.createStory,
);

// Story interactions
router.post("/:storyId/view", storyController.recordStoryView);
router.post("/:storyId/react", storyController.reactToStory);
router.post("/:storyId/reply", storyController.replyToStory);

// Story viewers (owner only)
router.get("/:storyId/viewers", storyController.getStoryViewers);

// Delete story (owner only)
router.delete("/:storyId", storyController.deleteStory);

export default router;
