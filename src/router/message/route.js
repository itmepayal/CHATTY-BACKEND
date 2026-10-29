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

// authMiddleware sabse pehle, taaki limiters ko req.user mile
router.use(authMiddleware);

router.route("/").get(messageController.getUsersForSidebar);

/* ---------- static GET routes ("/:id" se PEHLE) ---------- */
router.get("/scheduled", messageController.getScheduled);
router.get("/search/:id", messageController.searchMessages);
router.get("/pinned/:id", messageController.getPinned);
router.get("/disappearing/:id", messageController.getDisappearing);

router.route("/:id").get(messageController.getMessage);

/* ---------- send (limiter upload se pehle, taaki blocked request ki file save na ho) ---------- */
router
  .route("/send/:id")
  .post(
    sendMessageLimiter,
    upload.single("image"),
    enforceTypeSizeLimit,
    messageController.sendMessage,
  );

/* ---------- schedule ---------- */
router.post(
  "/schedule/:id",
  sendMessageLimiter,
  messageController.scheduleMessage,
);
router.delete("/scheduled/:scheduleId", messageController.cancelScheduled);

/* ---------- forward / edit / pin ---------- */
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

/* ---------- seen / react ---------- */
router.patch("/seen/:id", messageController.markMessagesSeen);
router.patch("/react/:messageId", reactLimiter, messageController.reactMessage);

/* ---------- disappearing + report ---------- */
router.put(
  "/disappearing/:id",
  settingsLimiter,
  messageController.setDisappearing,
);
router.post("/report/:id", reportLimiter, messageController.reportUser);

/* ---------- archive / unarchive chat (body: { archived: true | false }) ---------- */
router.patch("/archive/:id", settingsLimiter, messageController.setArchive);

/* ---------- delete ---------- */
router.delete(
  "/delete-for-me/:messageId",
  messageController.deleteMessageForMe,
);

router.delete(
  "/delete-for-everyone/:messageId",
  messageController.deleteMessageForEveryone,
);

export default router;
