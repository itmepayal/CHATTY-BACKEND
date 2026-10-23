import express from "express";
import rateLimit from "express-rate-limit";
import authController from "../../controllers/auth.controller.js";
import upload from "../../middlewares/multer.middleware.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import {
  setup2FA,
  enable2FA,
  verifyLogin2FA,
  disable2FA,
  regenerateRecoveryCodes,
} from "../../controllers/twoFactor.controller.js";
import {
  listSessions,
  revokeSession,
  revokeOtherSessions,
} from "../../controllers/sessions.controller.js";
import { deleteAccount } from "../../controllers/account.controller.js";

const router = express.Router();

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message:
      "Too many requests from this IP. Please try again after 15 minutes.",
  },
});

const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many verification attempts. Please try again later.",
  },
});

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

router.route("/sessions").get(authMiddleware, listSessions);
router
  .route("/sessions/revoke-others")
  .post(authMiddleware, revokeOtherSessions);
router.route("/sessions/:sessionId").delete(authMiddleware, revokeSession);

router.route("/2fa/setup").post(authMiddleware, setup2FA);
router.route("/2fa/enable").post(authMiddleware, twoFaLimiter, enable2FA);
router.route("/2fa/verify-login").post(twoFaLimiter, verifyLogin2FA);
router.route("/2fa/disable").post(authMiddleware, twoFaLimiter, disable2FA);
router
  .route("/2fa/recovery-codes/regenerate")
  .post(authMiddleware, twoFaLimiter, regenerateRecoveryCodes);

router.route("/account").delete(authMiddleware, strictLimiter, deleteAccount);

export default router;
