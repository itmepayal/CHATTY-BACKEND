import express from "express";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import usersController from "../../controllers/users.controller.js";
import upload from "../../middlewares/multer.middleware.js";

const router = express.Router();

router.route("/me").get(authMiddleware, usersController.getCurrentUser);

router.route("/profile").patch(authMiddleware, usersController.updateProfile);

router
  .route("/profile/avatar")
  .patch(authMiddleware, upload.single("avatar"), usersController.updateAvatar)
  .delete(authMiddleware, usersController.deleteAvatar);

router
  .route("/privacy")
  .get(authMiddleware, usersController.getPrivacySettings)
  .patch(authMiddleware, usersController.updatePrivacySettings);

router
  .route("/chat-prefs")
  .get(authMiddleware, usersController.getChatPrefs)
  .patch(authMiddleware, usersController.updateChatPrefs);

router
  .route("/appearance")
  .get(authMiddleware, usersController.getAppearance)
  .patch(authMiddleware, usersController.updateAppearance);

router
  .route("/:id/block")
  .post(authMiddleware, usersController.blockUser)
  .delete(authMiddleware, usersController.unblockUser);

router
  .route("/:id/favorite")
  .post(authMiddleware, usersController.addFavorite)
  .delete(authMiddleware, usersController.removeFavorite);

export default router;
