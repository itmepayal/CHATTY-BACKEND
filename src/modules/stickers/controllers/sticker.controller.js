import { StatusCodes } from "http-status-codes";
import * as marketplaceService from "../services/sticker-marketplace.service.js";
import * as creatorService from "../services/sticker-creator.service.js";
import StickerCategory from "../models/sticker-category.model.js";
import StickerPack from "../models/sticker-pack.model.js";
import Sticker from "../models/sticker.model.js";
import UserStickerLibrary from "../models/user-sticker-library.model.js";
import StickerPurchase from "../models/sticker-purchase.model.js";

export const getMarketplace = async (req, res) => {
  try {
    const { category, search, filter, page, limit } = req.query;
    const data = await marketplaceService.getMarketplaceFeed({
      category,
      search,
      filter,
      page,
      limit,
      userId: req.user?._id,
    });
    return res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch sticker marketplace",
    });
  }
};

export const getDiscover = async (req, res) => {
  try {
    const discoverData = await marketplaceService.getDiscoverFeed(req.user?._id);
    return res.status(StatusCodes.OK).json({ success: true, data: discoverData });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch sticker discover feed",
    });
  }
};

export const getCategories = async (_req, res) => {
  try {
    const categories = await marketplaceService.getCategoriesWithCounts();
    return res.status(StatusCodes.OK).json({ success: true, data: categories });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch sticker categories",
    });
  }
};

export const getPackDetails = async (req, res) => {
  try {
    const { packId } = req.params;
    const pack = await marketplaceService.getPackDetails(packId, req.user?._id);
    return res.status(StatusCodes.OK).json({ success: true, data: pack });
  } catch (error) {
    return res.status(StatusCodes.NOT_FOUND).json({
      success: false,
      message: error?.message || "Sticker pack not found",
    });
  }
};

export const searchStickers = async (req, res) => {
  try {
    const { q, limit = 40 } = req.query;
    if (!q || !q.trim()) {
      return res.status(StatusCodes.OK).json({
        success: true,
        data: { stickers: [], packs: [] },
      });
    }

    const regex = new RegExp(q.trim(), "i");
    const parsedLimit = Math.max(1, Math.min(100, Number(limit) || 40));

    // Search matching packs
    const matchingPacks = await StickerPack.find({
      status: "published",
      $or: [
        { name: regex },
        { category: regex },
        { tags: { $in: [regex] } },
        { creatorName: regex },
        { description: regex },
      ],
    })
      .limit(16)
      .lean();

    const matchingPackIds = matchingPacks.map((p) => p._id);

    // Search stickers matching name, altText, keywords, or from matching packs
    const stickers = await Sticker.find({
      $or: [
        { name: regex },
        { altText: regex },
        { keywords: { $in: [regex] } },
        { packId: { $in: matchingPackIds } },
      ],
    })
      .limit(parsedLimit)
      .populate("packId", "name slug isPremium coinPrice coverUrl isAnimated")
      .lean();

    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        stickers: stickers.map((s) => ({
          _id: s._id,
          id: String(s._id),
          name: s.name,
          url: s.url,
          thumbnailUrl: s.thumbnailUrl || s.url,
          altText: s.altText || s.name,
          format: s.format,
          isAnimated: Boolean(s.isAnimated),
          keywords: s.keywords || [],
          packId: s.packId?._id || s.packId,
          packName: s.packId?.name || "",
        })),
        packs: matchingPacks.map((p) => ({
          _id: p._id,
          id: String(p._id),
          name: p.name,
          coverUrl: p.coverUrl,
          category: p.category,
          isAnimated: Boolean(p.isAnimated),
          isPremium: Boolean(p.isPremium),
          coinPrice: p.coinPrice || 0,
          stickersCount: p.stickersCount || 0,
        })),
      },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Search failed",
    });
  }
};

export const getUserLibrary = async (req, res) => {
  try {
    const library = await marketplaceService.getUserLibrary(req.user._id);
    return res.status(StatusCodes.OK).json({ success: true, data: library });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch sticker library",
    });
  }
};

export const installPack = async (req, res) => {
  try {
    const { packId } = req.params;
    const installed = await marketplaceService.installPack(req.user._id, packId);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Sticker pack installed successfully",
      data: installed,
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to install sticker pack",
    });
  }
};

export const uninstallPack = async (req, res) => {
  try {
    const { packId } = req.params;
    await marketplaceService.uninstallPack(req.user._id, packId);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Sticker pack removed from library",
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to uninstall sticker pack",
    });
  }
};

export const purchasePack = async (req, res) => {
  try {
    const { packId } = req.params;
    const result = await marketplaceService.purchasePack(req.user._id, packId);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Sticker pack purchased successfully",
      data: result,
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Purchase failed",
    });
  }
};

export const toggleFavorite = async (req, res) => {
  try {
    const { stickerId } = req.params;
    const result = await marketplaceService.toggleFavoriteSticker(req.user._id, stickerId);
    return res.status(StatusCodes.OK).json({ success: true, data: result });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to toggle favorite",
    });
  }
};

export const getFavorites = async (req, res) => {
  try {
    const favorites = await marketplaceService.getFavoriteStickers(req.user._id);
    return res.status(StatusCodes.OK).json({ success: true, data: favorites });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch favorite stickers",
    });
  }
};

export const getRecents = async (req, res) => {
  try {
    const recents = await marketplaceService.getRecentStickers(req.user._id);
    return res.status(StatusCodes.OK).json({ success: true, data: recents });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch recent stickers",
    });
  }
};

export const clearRecents = async (req, res) => {
  try {
    await marketplaceService.clearRecentStickers(req.user._id);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Recent stickers cleared successfully",
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to clear recent stickers",
    });
  }
};

export const reorderPacks = async (req, res) => {
  try {
    const { orderedPackIds } = req.body;
    await marketplaceService.reorderInstalledPacks(req.user._id, orderedPackIds);
    return res.status(StatusCodes.OK).json({ success: true, message: "Packs reordered successfully" });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to reorder packs",
    });
  }
};

// Creator Studio Controllers
export const createPackDraft = async (req, res) => {
  try {
    const pack = await creatorService.createPack(req.user._id, req.body);
    return res.status(StatusCodes.CREATED).json({ success: true, data: pack });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to create sticker pack draft",
    });
  }
};

export const uploadPackStickers = async (req, res) => {
  try {
    const { packId } = req.params;
    let files = [];
    if (Array.isArray(req.files)) {
      files = req.files;
    } else if (req.files && typeof req.files === "object") {
      files = [...(req.files.files || []), ...(req.files.stickers || [])];
    } else if (req.file) {
      files = [req.file];
    }
    const meta = typeof req.body.metadata === "string" ? JSON.parse(req.body.metadata) : req.body.metadata || [];

    const stickers = await creatorService.addStickersToPack(req.user._id, packId, files, meta);
    return res.status(StatusCodes.OK).json({ success: true, data: stickers });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to upload stickers",
    });
  }
};

export const submitPackForReview = async (req, res) => {
  try {
    const { packId } = req.params;
    const pack = await creatorService.submitPackForReview(req.user._id, packId);
    return res.status(StatusCodes.OK).json({ success: true, data: pack });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to submit pack for review",
    });
  }
};

export const getMyCreatorPacks = async (req, res) => {
  try {
    const packs = await creatorService.getMyCreatorPacks(req.user._id);
    return res.status(StatusCodes.OK).json({ success: true, data: packs });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch creator packs",
    });
  }
};

// Admin Controllers
export const adminGetPendingPacks = async (_req, res) => {
  try {
    const pending = await creatorService.adminGetPendingPacks();
    return res.status(StatusCodes.OK).json({ success: true, data: pending });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch pending packs",
    });
  }
};

export const adminUpdatePackStatus = async (req, res) => {
  try {
    const { packId } = req.params;
    const { status, rejectionReason } = req.body;
    const updated = await creatorService.adminUpdatePackStatus(req.user._id, packId, {
      status,
      rejectionReason,
    });
    return res.status(StatusCodes.OK).json({ success: true, data: updated });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to update pack status",
    });
  }
};

export const adminGetMarketplaceAnalytics = async (_req, res) => {
  try {
    const [totalPacks, totalStickers, totalInstalls, totalPurchases] = await Promise.all([
      StickerPack.countDocuments({ status: "published" }),
      Sticker.countDocuments(),
      UserStickerLibrary.countDocuments(),
      StickerPurchase.countDocuments(),
    ]);
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        totalPacks,
        totalStickers,
        totalInstalls,
        totalPurchases,
      },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch analytics",
    });
  }
};

export const adminCreateCategory = async (req, res) => {
  try {
    const { name, slug, description, icon, displayOrder } = req.body;
    if (!name || !slug) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "name and slug are required",
      });
    }
    const cat = await StickerCategory.create({
      name,
      slug,
      description,
      icon,
      displayOrder: displayOrder || 0,
    });
    return res.status(StatusCodes.CREATED).json({ success: true, data: cat });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to create category",
    });
  }
};

export const getStickerAssetIntegrityReport = async (_req, res) => {
  try {
    const report = await marketplaceService.getStickerAssetIntegrityReport();
    return res.status(StatusCodes.OK).json({ success: true, data: report });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to generate sticker asset integrity report",
    });
  }
};
