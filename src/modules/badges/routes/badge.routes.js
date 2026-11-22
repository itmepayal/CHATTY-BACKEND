import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import * as badgeController from "../controllers/badge.controller.js";
import ApiError from "../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";

const router = Router();

// Middleware to verify admin privileges
const requireAdmin = (req, _res, next) => {
  if (req.user?.role !== "admin") {
    throw new ApiError(StatusCodes.FORBIDDEN, "Admin privileges required.");
  }
  next();
};

// Public / Authenticated catalog endpoints
router.get("/", authMiddleware, badgeController.getBadgesCatalog);
router.get("/catalog", authMiddleware, badgeController.getBadgesCatalog);
router.get("/my", authMiddleware, badgeController.getMyBadges);
router.get("/my/badges", authMiddleware, badgeController.getMyBadges);
router.get("/achievements", authMiddleware, badgeController.getMyAchievements);
router.get("/my/achievements", authMiddleware, badgeController.getMyAchievements);
router.get("/user/:userId", authMiddleware, badgeController.getUserBadges);
router.get("/:badgeId", authMiddleware, badgeController.getBadgeDetails);

// User badge personalization
router.patch("/featured", authMiddleware, badgeController.setFeaturedBadge);
router.put("/featured", authMiddleware, badgeController.setFeaturedBadge);
router.post("/featured/:badgeId", authMiddleware, badgeController.setFeaturedBadge);
router.put("/featured/:badgeId", authMiddleware, badgeController.setFeaturedBadge);
router.patch("/visibility", authMiddleware, badgeController.updateBadgeVisibility);
router.put("/visibility", authMiddleware, badgeController.updateBadgeVisibility);

// Admin endpoints
router.get("/admin/audit-logs", authMiddleware, requireAdmin, badgeController.adminGetAuditLogs);
router.post("/admin/create", authMiddleware, requireAdmin, badgeController.adminCreateBadge);
router.post("/admin/award", authMiddleware, requireAdmin, badgeController.adminAwardBadge);
router.post("/admin/revoke", authMiddleware, requireAdmin, badgeController.adminRevokeBadge);

export default router;
