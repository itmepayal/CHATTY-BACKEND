import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import * as giftController from "../controllers/gift.controller.js";
import ApiError from "../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";

const router = Router();

const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin") {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Administrative privileges required.",
    );
  }
  next();
};

// Public / Authenticated catalog discovery routes
router.get("/", giftController.getCatalog);
router.get("/categories", giftController.getCategories);
router.get("/featured", giftController.getFeatured);
router.get("/collection/:userId", giftController.getUserCollection);

// User Wallet routes (Requires Auth)
router.get("/wallet/me", authMiddleware, giftController.getMyWallet);
router.post(
  "/wallet/claim-daily-bonus",
  authMiddleware,
  giftController.claimBonus,
);
router.get(
  "/wallet/transactions",
  authMiddleware,
  giftController.getTransactions,
);

// Gifting Actions & History (Requires Auth)
router.post("/send", authMiddleware, giftController.sendGift);
router.get("/history/sent", authMiddleware, giftController.getSentHistory);
router.get(
  "/history/received",
  authMiddleware,
  giftController.getReceivedHistory,
);

// Favorites (Requires Auth) - Must be registered before /:idOrSlug
router.get("/favorites", authMiddleware, giftController.getFavorites);
router.post("/favorites/toggle/:idOrSlug", authMiddleware, giftController.toggleFavorite);
router.post("/:idOrSlug/favorite", authMiddleware, giftController.toggleFavorite);

// Single gift by ID or slug
router.get("/:idOrSlug", giftController.getGift);

// Admin Marketplace Management
router.post("/admin", authMiddleware, requireAdmin, giftController.adminCreateGift);
router.patch(
  "/admin/:id",
  authMiddleware,
  requireAdmin,
  giftController.adminUpdateGift,
);
router.delete(
  "/admin/:id",
  authMiddleware,
  requireAdmin,
  giftController.adminDeleteGift,
);
router.post(
  "/admin/credit-wallet",
  authMiddleware,
  requireAdmin,
  giftController.adminCreditCoins,
);
router.post(
  "/admin/wallet/credit",
  authMiddleware,
  requireAdmin,
  giftController.adminCreditCoins,
);

export default router;
