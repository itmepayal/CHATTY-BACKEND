import express from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import { settingsLimiter } from "../../../middlewares/rateLimit/index.js";
import notificationSettingsController from "../controllers/notification-settings.controller.js";

const router = express.Router();

router.use(authMiddleware);

// Matches /api/settings/notifications or /api/v1/settings/notifications
router
  .route("/notifications")
  .get(notificationSettingsController.getNotificationSettings)
  .patch(settingsLimiter, notificationSettingsController.updateNotificationSettings);

// Also handle root if mounted at /settings/notifications
router
  .route("/")
  .get(notificationSettingsController.getNotificationSettings)
  .patch(settingsLimiter, notificationSettingsController.updateNotificationSettings);

export default router;
