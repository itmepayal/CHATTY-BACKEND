import express from "express";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import usersController from "../../controllers/users.controller.js";
import upload from "../../middlewares/multer.middleware.js";
import { settingsLimiter } from "../../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.use(authMiddleware);

/* ---------- CURRENT USER ---------- */
router.get("/me", usersController.getCurrentUser);

/* ---------- PROFILE ---------- */
router.patch("/profile", usersController.updateProfile);

router
  .route("/profile/avatar")
  .patch(upload.single("avatar"), usersController.updateAvatar)
  .delete(usersController.deleteAvatar);

/* ---------- SETTINGS ---------- */
router
  .route("/privacy")
  .get(usersController.getPrivacySettings)
  .patch(settingsLimiter, usersController.updatePrivacySettings);

router
  .route("/chat-prefs")
  .get(usersController.getChatPrefs)
  .patch(settingsLimiter, usersController.updateChatPrefs);

router
  .route("/appearance")
  .get(usersController.getAppearance)
  .patch(settingsLimiter, usersController.updateAppearance);

/* ---------- E2EE PUBLIC KEY ---------- */
// "/me/public-key" is declared before "/:id/public-key"
router.put("/me/public-key", settingsLimiter, usersController.setMyPublicKey);
router.get("/:id/public-key", usersController.getUserPublicKey);

/* ---------- BLOCK / FAVORITE ---------- */
router
  .route("/:id/block")
  .post(settingsLimiter, usersController.blockUser)
  .delete(settingsLimiter, usersController.unblockUser);

router
  .route("/:id/favorite")
  .post(settingsLimiter, usersController.addFavorite)
  .delete(settingsLimiter, usersController.removeFavorite);

export default router;
