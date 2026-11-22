import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import notificationController from "../controllers/notification.controller.js";

const router = Router();

router.use(authMiddleware);

router.get("/", notificationController.getNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.patch("/read-all", notificationController.markAllAsRead);
router.patch("/:id/read", notificationController.markAsRead);
router.patch("/:id/unread", notificationController.markAsUnread);
router.delete("/clear-all", notificationController.clearAllNotifications);
router.delete("/clear-read", notificationController.clearReadNotifications);
router.delete("/:id", notificationController.deleteNotification);

export default router;
