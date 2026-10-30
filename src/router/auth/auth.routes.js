import express from "express";
import authController from "../../controllers/auth.controller.js";
import upload from "../../middlewares/multer.middleware.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import twoFactorController from "../../controllers/twoFactor.controller.js";
import sessionController from "../../controllers/sessions.controller.js";
import accountController from "../../controllers/account.controller.js";
import {
  strictLimiter,
  twoFaLimiter,
} from "../../middlewares/rateLimit/auth-rate-limit.middleware.js";

const router = express.Router();

router.route("/login").post(authController.loginUser);
router
  .route("/register")
  .post(upload.single("avatar"), authController.registerUser);

router.route("/logout").post(authMiddleware, authController.logoutUser);
router.route("/check").get(authMiddleware, authController.checkAuth);

router
  .route("/change-password")
  .patch(authMiddleware, strictLimiter, authController.changePassword);

router
  .route("/forgot-password")
  .post(strictLimiter, authController.forgotPassword);
router
  .route("/reset-password/:token")
  .post(strictLimiter, authController.resetPassword);

router
  .route("/security/login-alerts")
  .patch(authMiddleware, authController.updateLoginAlerts);

router.route("/sessions").get(authMiddleware, sessionController.listSessions);
router
  .route("/sessions/revoke-others")
  .post(authMiddleware, sessionController.revokeOtherSessions);
router
  .route("/sessions/:sessionId")
  .delete(authMiddleware, sessionController.revokeSession);

router.route("/2fa/setup").post(authMiddleware, twoFactorController.setup2FA);
router
  .route("/2fa/enable")
  .post(authMiddleware, twoFaLimiter, twoFactorController.enable2FA);
router
  .route("/2fa/verify-login")
  .post(twoFaLimiter, twoFactorController.verifyLogin2FA);
router
  .route("/2fa/disable")
  .post(authMiddleware, twoFaLimiter, twoFactorController.disable2FA);
router
  .route("/2fa/recovery-codes/regenerate")
  .post(
    authMiddleware,
    twoFaLimiter,
    twoFactorController.regenerateRecoveryCodes,
  );

router
  .route("/account")
  .delete(authMiddleware, strictLimiter, accountController.deleteAccount);

export default router;
