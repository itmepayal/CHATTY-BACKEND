import express from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import usersController from "../controllers/users.controller.js";
import userLockController from "../controllers/user-lock.controller.js";
import messageController from "../../messaging/controllers/messages.controller.js";
import notificationSettingsController from "../../notifications/controllers/notification-settings.controller.js";
import upload, {
  autoCleanupMulterOnFailure,
} from "../../../middlewares/multer.middleware.js";
import { settingsLimiter, lockLimiter, reportLimiter } from "../../../middlewares/rateLimit/index.js";
import { validate } from "../../../middlewares/validation/validate.middleware.js";
import {
  verifyLockPinSchema,
  setupLockPinSchema,
  disableLockPinSchema,
} from "../validations/user-lock.validation.js";

const router = express.Router();

router.use(authMiddleware);

router.post(
  "/lock/verify",
  lockLimiter,
  validate(verifyLockPinSchema),
  userLockController.verifyLockPin,
);
router.post(
  "/lock/setup",
  settingsLimiter,
  validate(setupLockPinSchema),
  userLockController.setupLockPin,
);
router.post(
  "/lock/disable",
  settingsLimiter,
  validate(disableLockPinSchema),
  userLockController.disableLockPin,
);

router.get("/me", usersController.getCurrentUser);
router.get("/me/qr", usersController.getUserQRCode);
router.post("/resolve-qr", usersController.resolveQRPayload);
router.patch("/profile", usersController.updateProfile);
router
  .route("/profile/avatar")
  .patch(
    upload.single("avatar"),
    autoCleanupMulterOnFailure,
    usersController.updateAvatar,
  )
  .delete(usersController.deleteAvatar);
router
  .route("/privacy")
  .get(usersController.getPrivacySettings)
  .put(settingsLimiter, usersController.updatePrivacySettings)
  .patch(settingsLimiter, usersController.updatePrivacySettings);
router
  .route("/chat-prefs")
  .get(usersController.getChatPrefs)
  .patch(settingsLimiter, usersController.updateChatPrefs);
router
  .route("/appearance")
  .get(usersController.getAppearance)
  .patch(settingsLimiter, usersController.updateAppearance);
router
  .route("/notifications")
  .get(notificationSettingsController.getNotificationSettings)
  .patch(settingsLimiter, notificationSettingsController.updateNotificationSettings);
router.put("/me/public-key", settingsLimiter, usersController.setMyPublicKey);
router.get("/blocked", usersController.getBlockedUsers);
router.get("/:id/profile", usersController.getUserProfile);
router.get("/:id/qr", usersController.getUserQRCode);
router.get("/:id/public-key", usersController.getUserPublicKey);
router
  .route("/:id/block")
  .post(settingsLimiter, usersController.blockUser)
  .delete(settingsLimiter, usersController.unblockUser);
router
  .route("/:id/favorite")
  .post(settingsLimiter, usersController.addFavorite)
  .delete(settingsLimiter, usersController.removeFavorite);
router.post("/:id/report", reportLimiter, messageController.reportUser);

router.get("/starred-messages", messageController.getStarred);
router.get("/starred-messages/:id", messageController.getStarred);
router.patch("/star-message/:messageId", messageController.toggleStar);
router.patch("/:id/pin-chat", settingsLimiter, messageController.setPinChat);
router.patch("/:id/mute-chat", settingsLimiter, messageController.setMuteChat);

export default router;
