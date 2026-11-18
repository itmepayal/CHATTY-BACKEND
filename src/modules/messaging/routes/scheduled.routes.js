import express from "express";
import messageController from "../controllers/messages.controller.js";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import { sendMessageLimiter } from "../../../middlewares/rateLimit/index.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/", messageController.getScheduled);
router.post("/", sendMessageLimiter, messageController.scheduleMessage);
router.patch("/:scheduleId", messageController.updateScheduled);
router.delete("/:scheduleId", messageController.cancelScheduled);
router.post(
  "/:scheduleId/send-now",
  sendMessageLimiter,
  messageController.sendScheduledNow,
);
router.post(
  "/:scheduleId/send",
  sendMessageLimiter,
  messageController.sendScheduledNow,
);

export default router;
