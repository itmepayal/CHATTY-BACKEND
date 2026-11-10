import express from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import usersController from "../controllers/users.controller.js";
import upload, {
  autoCleanupMulterOnFailure,
} from "../../../middlewares/multer.middleware.js";
import { settingsLimiter } from "../../../middlewares/rateLimit/index.js";

const router = express.Router();

router.use(authMiddleware);

router.get("/me", usersController.getCurrentUser);
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
router.put("/me/public-key", settingsLimiter, usersController.setMyPublicKey);
router.get("/:id/profile", usersController.getUserProfile);
router.get("/:id/public-key", usersController.getUserPublicKey);
router
  .route("/:id/block")
  .post(settingsLimiter, usersController.blockUser)
  .delete(settingsLimiter, usersController.unblockUser);
router
  .route("/:id/favorite")
  .post(settingsLimiter, usersController.addFavorite)
  .delete(settingsLimiter, usersController.removeFavorite);

export default router;
