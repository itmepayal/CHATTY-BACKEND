import express from "express";

import messageController from "../../controllers/messages.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";

import upload, {
  enforceTypeSizeLimit,
} from "../../middlewares/multer.middleware.js";

import {
  sendMessageLimiter,
  reactLimiter,
  forwardLimiter,
  reportLimiter,
  settingsLimiter,
} from "../../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", messageController.getUsersForSidebar);

router.post("/location/share", settingsLimiter, messageController.startShare);
router.patch(
  "/location/stop/:id",
  settingsLimiter,
  messageController.stopShare,
);
router.get("/location/active", messageController.getActiveShares);

router.get("/scheduled", messageController.getScheduled);
router.get("/search/:id", messageController.searchMessages);
router.get("/pinned/:id", messageController.getPinned);
router.get("/disappearing/:id", messageController.getDisappearing);

router.get("/:id", messageController.getMessage);

router.post(
  "/send/:id",
  sendMessageLimiter,
  upload.single("image"),
  enforceTypeSizeLimit,
  messageController.sendMessage,
);

router.post(
  "/schedule/:id",
  sendMessageLimiter,
  messageController.scheduleMessage,
);
router.delete("/scheduled/:scheduleId", messageController.cancelScheduled);

router.post(
  "/forward/:messageId",
  forwardLimiter,
  messageController.forwardMessage,
);

router.patch(
  "/edit/:messageId",
  sendMessageLimiter,
  messageController.editMessage,
);

router.patch("/pin/:messageId", messageController.togglePin);

router.patch("/seen/:id", messageController.markMessagesSeen);

router.patch("/react/:messageId", reactLimiter, messageController.reactMessage);

router.put(
  "/disappearing/:id",
  settingsLimiter,
  messageController.setDisappearing,
);

router.post("/report/:id", reportLimiter, messageController.reportUser);

router.patch("/archive/:id", settingsLimiter, messageController.setArchive);

router.delete(
  "/delete-for-me/:messageId",
  messageController.deleteMessageForMe,
);
router.delete(
  "/delete-for-everyone/:messageId",
  messageController.deleteMessageForEveryone,
);

export default router;
