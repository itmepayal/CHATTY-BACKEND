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

/* ---------- SIDEBAR ---------- */
router.get("/", messageController.getUsersForSidebar);

/* ---------- LOCATION SHARING ---------- */
router.post("/location/share", settingsLimiter, messageController.startShare);
router.patch(
  "/location/stop/:id",
  settingsLimiter,
  messageController.stopShare,
);
router.get("/location/active", messageController.getActiveShares);

/* ---------- STATIC GET ROUTES (must stay before "/:id") ---------- */
router.get("/scheduled", messageController.getScheduled);
router.get("/search/:id", messageController.searchMessages);
router.get("/pinned/:id", messageController.getPinned);
router.get("/disappearing/:id", messageController.getDisappearing);

/* ---------- GET MESSAGES ---------- */
router.get("/:id", messageController.getMessage);

/* ---------- SEND ---------- */
router.post(
  "/send/:id",
  sendMessageLimiter,
  upload.single("image"),
  enforceTypeSizeLimit,
  messageController.sendMessage,
);

/* ---------- SCHEDULE ---------- */
router.post(
  "/schedule/:id",
  sendMessageLimiter,
  messageController.scheduleMessage,
);
router.delete("/scheduled/:scheduleId", messageController.cancelScheduled);

/* ---------- FORWARD ---------- */
router.post(
  "/forward/:messageId",
  forwardLimiter,
  messageController.forwardMessage,
);

/* ---------- EDIT ---------- */
router.patch(
  "/edit/:messageId",
  sendMessageLimiter,
  messageController.editMessage,
);

/* ---------- PIN ---------- */
router.patch("/pin/:messageId", messageController.togglePin);

/* ---------- READ RECEIPTS ---------- */
router.patch("/seen/:id", messageController.markMessagesSeen);

/* ---------- REACTIONS ---------- */
router.patch("/react/:messageId", reactLimiter, messageController.reactMessage);

/* ---------- DISAPPEARING ---------- */
router.put(
  "/disappearing/:id",
  settingsLimiter,
  messageController.setDisappearing,
);

/* ---------- REPORT ---------- */
router.post("/report/:id", reportLimiter, messageController.reportUser);

/* ---------- ARCHIVE ---------- */
router.patch("/archive/:id", settingsLimiter, messageController.setArchive);

/* ---------- DELETE ---------- */
router.delete(
  "/delete-for-me/:messageId",
  messageController.deleteMessageForMe,
);
router.delete(
  "/delete-for-everyone/:messageId",
  messageController.deleteMessageForEveryone,
);

export default router;
