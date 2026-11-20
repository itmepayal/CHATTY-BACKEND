import express from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import { settingsLimiter } from "../../../middlewares/rateLimit/index.js";
import notificationSettingsController from "../controllers/notification-settings.controller.js";

const router = express.Router();

router.use(authMiddleware);

// Core notification settings (sound, volume, desktop, preview)
router
  .route("/notifications")
  .get(notificationSettingsController.getNotificationSettings)
  .patch(settingsLimiter, notificationSettingsController.updateNotificationSettings);

// Also handle root if mounted at /settings/notifications
router
  .route("/")
  .get(notificationSettingsController.getNotificationSettings)
  .patch(settingsLimiter, notificationSettingsController.updateNotificationSettings);

// Extended notification preferences (categories, DND)
router
  .route("/notifications/preferences")
  .get(notificationSettingsController.getNotificationSettings)
  .patch(settingsLimiter, notificationSettingsController.updateNotificationPreferences);

// Per-conversation / per-group mute
router
  .route("/notifications/mute")
  .post(notificationSettingsController.muteChat)
  .delete(notificationSettingsController.unmuteChat);

// Push subscription management
router
  .route("/notifications/push-subscription")
  .post(notificationSettingsController.savePushSubscription)
  .delete(notificationSettingsController.removePushSubscription);

export default router;
