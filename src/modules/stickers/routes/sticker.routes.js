import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import upload from "../../../middlewares/multer.middleware.js";
import * as stickerController from "../controllers/sticker.controller.js";
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

// Marketplace browsing
router.get("/discover", authMiddleware, stickerController.getDiscover);
router.get("/packs", authMiddleware, stickerController.getMarketplace);
router.get("/marketplace", authMiddleware, stickerController.getMarketplace);
router.get("/categories", authMiddleware, stickerController.getCategories);
router.get("/packs/:packId", authMiddleware, stickerController.getPackDetails);
router.get("/search", authMiddleware, stickerController.searchStickers);

// User library & personalization
router.get("/library", authMiddleware, stickerController.getUserLibrary);
router.get("/favorites", authMiddleware, stickerController.getFavorites);
router.get("/recent", authMiddleware, stickerController.getRecents);
router.delete("/recent", authMiddleware, stickerController.clearRecents);

router.post("/packs/:packId/install", authMiddleware, stickerController.installPack);
router.post("/install/:packId", authMiddleware, stickerController.installPack);
router.delete("/packs/:packId/install", authMiddleware, stickerController.uninstallPack);
router.post("/uninstall/:packId", authMiddleware, stickerController.uninstallPack);
router.post("/packs/:packId/purchase", authMiddleware, stickerController.purchasePack);
router.post("/purchase/:packId", authMiddleware, stickerController.purchasePack);
router.post("/:stickerId/favorite", authMiddleware, stickerController.toggleFavorite);
router.post("/favorites/:stickerId", authMiddleware, stickerController.toggleFavorite);
router.post("/packs/reorder", authMiddleware, stickerController.reorderPacks);
router.put("/library/order", authMiddleware, stickerController.reorderPacks);

// Creator studio
router.post("/creators/packs", authMiddleware, stickerController.createPackDraft);
router.post("/creator/packs", authMiddleware, stickerController.createPackDraft);
router.post(
  "/creators/packs/:packId/stickers",
  authMiddleware,
  upload.fields([
    { name: "files", maxCount: 30 },
    { name: "stickers", maxCount: 30 },
  ]),
  stickerController.uploadPackStickers,
);
router.post(
  "/creator/packs/:packId/stickers",
  authMiddleware,
  upload.fields([
    { name: "files", maxCount: 30 },
    { name: "stickers", maxCount: 30 },
  ]),
  stickerController.uploadPackStickers,
);
router.post("/creators/packs/:packId/submit", authMiddleware, stickerController.submitPackForReview);
router.post("/creator/packs/:packId/submit", authMiddleware, stickerController.submitPackForReview);
router.get("/creators/my-packs", authMiddleware, stickerController.getMyCreatorPacks);
router.get("/creator/packs", authMiddleware, stickerController.getMyCreatorPacks);

// Admin moderation & analytics & asset integrity
router.get("/integrity", authMiddleware, stickerController.getStickerAssetIntegrityReport);
router.get("/admin/integrity", authMiddleware, requireAdmin, stickerController.getStickerAssetIntegrityReport);
router.get("/admin/analytics", authMiddleware, requireAdmin, stickerController.adminGetMarketplaceAnalytics);
router.post("/admin/categories", authMiddleware, requireAdmin, stickerController.adminCreateCategory);
router.get("/admin/pending", authMiddleware, requireAdmin, stickerController.adminGetPendingPacks);
router.post("/admin/packs/:packId/status", authMiddleware, requireAdmin, stickerController.adminUpdatePackStatus);

export default router;
