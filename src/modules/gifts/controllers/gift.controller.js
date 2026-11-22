import * as giftCatalogService from "../services/gift-catalog.service.js";
import * as walletService from "../services/wallet.service.js";
import * as giftTransactionService from "../services/gift-transaction.service.js";
import ApiResponse from "../../../shared/responses/api-response.js";
import { StatusCodes } from "http-status-codes";

/**
 * GET /api/v1/gifts
 * Retrieves catalog with filtering, sorting, and pagination.
 */
export const getCatalog = async (req, res, next) => {
  try {
    const currentUserId = req.user?._id || req.query.userId || null;
    const data = await giftCatalogService.getGiftCatalog(req.query, currentUserId);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, data, "Catalog fetched successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/categories
 * Retrieves 25 gift categories with real-time active gift counts.
 */
export const getCategories = async (req, res, next) => {
  try {
    const categories = await giftCatalogService.getGiftCategories();
    return res
      .status(StatusCodes.OK)
      .json(
        new ApiResponse(
          StatusCodes.OK,
          categories,
          "Gift categories fetched successfully.",
        ),
      );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/featured
 * Retrieves curated gift highlights (trending, popular, limited edition, premium).
 */
export const getFeatured = async (req, res, next) => {
  try {
    const featured = await giftCatalogService.getFeaturedGifts();
    return res
      .status(StatusCodes.OK)
      .json(
        new ApiResponse(
          StatusCodes.OK,
          featured,
          "Featured gifts fetched successfully.",
        ),
      );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/:idOrSlug
 * Retrieves a single gift by ID or slug.
 */
export const getGift = async (req, res, next) => {
  try {
    const gift = await giftCatalogService.getGiftByIdOrSlug(req.params.idOrSlug);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, gift, "Gift details fetched."));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/wallet/me
 * Retrieves current user's wallet balance and daily bonus status.
 */
export const getMyWallet = async (req, res, next) => {
  try {
    const wallet = await walletService.getOrCreateWallet(req.user._id);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, wallet, "Wallet retrieved."));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/gifts/wallet/claim-daily-bonus
 * Claims free daily login coins.
 */
export const claimBonus = async (req, res, next) => {
  try {
    const result = await walletService.claimDailyBonus(req.user._id);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, result, result.message));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/wallet/transactions
 * Retrieves transaction history for current user.
 */
export const getTransactions = async (req, res, next) => {
  try {
    const history = await walletService.getTransactionHistory(
      req.user._id,
      req.query,
    );
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, history, "Transactions fetched."));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/gifts/send
 * Processes transactional gift send with atomic coin deduction and message delivery.
 */
export const sendGift = async (req, res, next) => {
  try {
    const {
      recipientId,
      groupId,
      giftId,
      giftSlug,
      note,
      personalMessage,
      idempotencyKey,
      chatType,
    } = req.body;

    const result = await giftTransactionService.sendGift({
      senderId: req.user._id,
      recipientId,
      groupId,
      giftIdOrSlug: giftId || giftSlug,
      giftSlug,
      personalMessage: personalMessage || note || "",
      idempotencyKey,
      chatType,
    });

    if (result.isDuplicate) {
      return res.status(StatusCodes.OK).json({
        success: true,
        idempotentReplay: true,
        data: result,
        message: result.message,
      });
    }

    return res
      .status(StatusCodes.CREATED)
      .json(new ApiResponse(StatusCodes.CREATED, result, "Gift sent successfully!"));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/history/sent
 * Retrieves gifts sent by the current user.
 */
export const getSentHistory = async (req, res, next) => {
  try {
    const data = await giftTransactionService.getSentGifts(
      req.user._id,
      req.query,
    );
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, data, "Sent gifts history fetched."));
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/history/received
 * Retrieves gifts received by the current user.
 */
export const getReceivedHistory = async (req, res, next) => {
  try {
    const data = await giftTransactionService.getReceivedGifts(
      req.user._id,
      req.query,
    );
    return res
      .status(StatusCodes.OK)
      .json(
        new ApiResponse(
          StatusCodes.OK,
          data,
          "Received gifts history fetched.",
        ),
      );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/collection/:userId
 * Retrieves public profile showcase of gifts.
 */
export const getUserCollection = async (req, res, next) => {
  try {
    const data = await giftTransactionService.getUserGiftCollection(
      req.params.userId,
    );
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, data, "User gift collection fetched."));
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/v1/gifts/favorites/toggle/:idOrSlug
 * POST /api/v1/gifts/:idOrSlug/favorite
 * Toggles a gift in current user's favorites.
 */
export const toggleFavorite = async (req, res, next) => {
  try {
    const idOrSlug = req.params.idOrSlug || req.params.id;
    const result = await giftCatalogService.toggleFavorite(req.user._id, idOrSlug);
    return res
      .status(StatusCodes.OK)
      .json(
        new ApiResponse(
          StatusCodes.OK,
          result,
          result.isFavorited ? "Added to favorites." : "Removed from favorites.",
        ),
      );
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/v1/gifts/favorites
 * Retrieves current user's favorited gifts.
 */
export const getFavorites = async (req, res, next) => {
  try {
    const favorites = await giftCatalogService.getUserFavorites(req.user._id);
    return res
      .status(StatusCodes.OK)
      .json(
        new ApiResponse(
          StatusCodes.OK,
          favorites,
          "User favorites fetched successfully.",
        ),
      );
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Create gift.
 */
export const adminCreateGift = async (req, res, next) => {
  try {
    const gift = await giftCatalogService.createGift(req.body);
    return res
      .status(StatusCodes.CREATED)
      .json(new ApiResponse(StatusCodes.CREATED, gift, "Gift created successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Update gift.
 */
export const adminUpdateGift = async (req, res, next) => {
  try {
    const gift = await giftCatalogService.updateGift(req.params.id, req.body);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, gift, "Gift updated successfully."));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Deactivate gift.
 */
export const adminDeleteGift = async (req, res, next) => {
  try {
    const result = await giftCatalogService.deleteGift(req.params.id);
    return res
      .status(StatusCodes.OK)
      .json(new ApiResponse(StatusCodes.OK, result, "Gift deactivated."));
  } catch (err) {
    next(err);
  }
};

/**
 * Admin: Credit coins to any user.
 */
export const adminCreditCoins = async (req, res, next) => {
  try {
    const { userId, amount, reason } = req.body;
    const wallet = await walletService.creditCoins({
      userId,
      amount: Number(amount),
      type: "admin_credit",
      metadata: { reason: reason || "Admin credit adjustment" },
    });
    return res
      .status(StatusCodes.OK)
      .json(
        new ApiResponse(
          StatusCodes.OK,
          wallet,
          `Successfully credited ${amount} coins.`,
        ),
      );
  } catch (err) {
    next(err);
  }
};
