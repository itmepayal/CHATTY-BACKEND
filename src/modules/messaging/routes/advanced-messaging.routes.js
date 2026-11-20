import express from "express";
import * as advancedController from "../controllers/advanced-messaging.controller.js";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import { sendMessageLimiter, reactLimiter } from "../../../middlewares/rateLimit/index.js";

const router = express.Router();

router.use(authMiddleware);

// Advanced Messaging: Polls
router.post("/polls", sendMessageLimiter, advancedController.createPoll);
router.post("/:messageId/poll/vote", advancedController.castVote);
router.post("/:messageId/poll/close", advancedController.closePoll);
router.post("/:messageId/poll/end", advancedController.closePoll);
router.get("/:messageId/poll", advancedController.getPollDetails);

// Advanced Messaging: Multi-Reactions & Reaction details
router.post("/:messageId/reactions", reactLimiter, advancedController.toggleReaction);
router.get("/:messageId/reactions", advancedController.getReactionDetails);

// Advanced Messaging: Threads
router.get("/:messageId/thread", advancedController.getThread);
router.post("/:messageId/thread", sendMessageLimiter, advancedController.sendThreadReply);

// Advanced Messaging: View-Once Media
router.post("/:messageId/view-once/open", advancedController.markViewOnceOpened);

export default router;
