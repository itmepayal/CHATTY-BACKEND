import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import StickerCategory from "../models/sticker-category.model.js";
import StickerPack, { PACK_STATUSES } from "../models/sticker-pack.model.js";
import Sticker from "../models/sticker.model.js";
import UserStickerLibrary from "../models/user-sticker-library.model.js";
import UserFavoriteSticker from "../models/user-favorite-sticker.model.js";
import StickerUsage from "../models/sticker-usage.model.js";
import StickerPurchase from "../models/sticker-purchase.model.js";
import Wallet from "../../gifts/models/wallet.model.js";
import {
  DEFAULT_STICKER_CATEGORIES,
  DEFAULT_STICKER_PACKS,
} from "../data/default-sticker-packs.data.js";
import { trackActivity } from "../../badges/services/achievement-engine.service.js";

/**
 * Ensures default categories and sticker packs exist on startup.
 * Automatically updates existing packs with local SVG assets and fixes broken remote URLs.
 */
export const ensureDefaultStickerPacksSeeded = async (defaultAdminId = null) => {
  try {
    // 1. Seed & synchronize categories
    for (let i = 0; i < DEFAULT_STICKER_CATEGORIES.length; i++) {
      const cat = DEFAULT_STICKER_CATEGORIES[i];
      await StickerCategory.findOneAndUpdate(
        { slug: cat.slug },
        {
          $set: {
            name: cat.name,
            icon: cat.icon,
            description: cat.description,
            displayOrder: i,
            isActive: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }

    const adminObjectId =
      defaultAdminId || new mongoose.Types.ObjectId("6b0000000000000000000001");

    // 1b. Clean up obsolete legacy placeholder packs if any exist
    const validSlugs = DEFAULT_STICKER_PACKS.map((p) => p.slug);
    const legacyPacks = await StickerPack.find({
      slug: { $nin: validSlugs },
      $or: [
        { creatorName: { $in: ["Chatty Official", "Chatty Studio"] } },
        { coverUrl: { $regex: "/assets/gifts/" } },
      ],
    }).select("_id");
    if (legacyPacks.length > 0) {
      const legacyIds = legacyPacks.map((p) => p._id);
      await Sticker.deleteMany({ packId: { $in: legacyIds } });
      await UserStickerLibrary.deleteMany({ packId: { $in: legacyIds } });
      await StickerPack.deleteMany({ _id: { $in: legacyIds } });
    }

    // 2. Seed & synchronize packs
    for (let packIndex = 0; packIndex < DEFAULT_STICKER_PACKS.length; packIndex++) {
      const packDef = DEFAULT_STICKER_PACKS[packIndex];
      const packMeta = {
        name: packDef.name,
        slug: packDef.slug,
        description: packDef.description,
        coverUrl: packDef.coverUrl,
        category: packDef.category,
        tags: packDef.tags,
        isAnimated: Boolean(packDef.isAnimated),
        isPremium: Boolean(packDef.isPremium),
        coinPrice: Number(packDef.coinPrice) || 0,
        status: PACK_STATUSES.PUBLISHED,
        stickersCount: packDef.stickers?.length || 0,
        isFeatured: Boolean(packDef.isFeatured),
        isTrending: Boolean(packDef.isTrending),
        displayOrder: packIndex,
      };

      let pack = await StickerPack.findOne({ slug: packDef.slug });
      if (!pack) {
        pack = await StickerPack.create({
          ...packMeta,
          creatorId: adminObjectId,
          creatorName: "Chatty Official",
        });
      } else {
        await StickerPack.findByIdAndUpdate(pack._id, { $set: packMeta });
      }

      // 3. Inspect existing stickers for this pack
      const existingStickersCount = await Sticker.countDocuments({ packId: pack._id });
      const hasBrokenExternalUrls = await Sticker.exists({
        packId: pack._id,
        url: { $regex: "api.iconify.design" },
      });
      const hasOldGiftUrls = await Sticker.exists({
        packId: pack._id,
        url: { $regex: "/assets/gifts/" },
      });

      // If no stickers or has broken external URLs or old gift URLs or count mismatch with seed definition
      if (
        existingStickersCount === 0 ||
        hasBrokenExternalUrls ||
        hasOldGiftUrls ||
        existingStickersCount !== (packDef.stickers?.length || 0)
      ) {
        await Sticker.deleteMany({ packId: pack._id });

        if (Array.isArray(packDef.stickers) && packDef.stickers.length > 0) {
          const stickerDocs = packDef.stickers.map((stk, index) => ({
            packId: pack._id,
            name: stk.name,
            url: stk.url,
            thumbnailUrl: stk.thumbnailUrl || stk.url,
            altText: stk.altText || stk.name,
            keywords: stk.keywords || [],
            format: stk.format || (stk.url?.endsWith(".svg") ? "svg" : "webp"),
            isAnimated: Boolean(packDef.isAnimated),
            displayOrder: index,
          }));

          await Sticker.insertMany(stickerDocs);
          await StickerPack.findByIdAndUpdate(pack._id, {
            stickersCount: stickerDocs.length,
          });
        }
      }
    }
  } catch (error) {
    console.error("[StickerMarketplace] Seed error:", error?.message || error);
  }
};

/**
 * Normalizes sticker objects for client consumption.
 */
const normalizeSticker = (s, packName = "") => {
  if (!s) return null;
  const idStr = String(s._id || s.id || s.stickerId || "");
  return {
    _id: s._id || idStr,
    id: idStr,
    stickerId: idStr,
    packId: s.packId,
    packName: s.packName || packName,
    name: s.name || "Sticker",
    url: s.url,
    thumbnailUrl: s.thumbnailUrl || s.url,
    altText: s.altText || s.name || "Sticker",
    format: s.format || (s.url?.endsWith(".svg") ? "svg" : "webp"),
    isAnimated: Boolean(s.isAnimated),
  };
};

/**
 * Fetches sticker marketplace packs with category filtering, search, and pagination.
 */
export const getMarketplaceFeed = async ({
  category = "",
  search = "",
  filter = "all", // "all" | "featured" | "trending" | "popular" | "newest" | "free" | "premium"
  page = 1,
  limit = 24,
  userId = null,
} = {}) => {
  const query = { status: PACK_STATUSES.PUBLISHED };

  if (category && category !== "all") {
    query.category = category.toLowerCase().trim();
  }

  if (search && search.trim()) {
    const s = search.trim();
    const regex = new RegExp(s, "i");

    // Search matching individual stickers to also include their parent packs
    const matchingStickers = await Sticker.find({
      $or: [{ name: regex }, { altText: regex }, { keywords: { $in: [regex] } }],
    })
      .select("packId")
      .limit(100)
      .lean();

    const matchingPackIds = matchingStickers.map((stk) => stk.packId);

    query.$or = [
      { name: regex },
      { tags: { $in: [regex] } },
      { description: regex },
      { _id: { $in: matchingPackIds } },
    ];
  }

  if (filter === "featured") query.isFeatured = true;
  if (filter === "trending") query.isTrending = true;
  if (filter === "free") query.isPremium = false;
  if (filter === "premium") query.isPremium = true;

  let sort = { displayOrder: 1, isFeatured: -1, createdAt: -1 };
  if (filter === "popular") sort = { installedCount: -1, usageCount: -1, displayOrder: 1 };
  if (filter === "trending") sort = { isTrending: -1, usageCount: -1, updatedAt: -1 };
  if (filter === "newest") sort = { createdAt: -1 };

  const parsedPage = Math.max(1, Number(page) || 1);
  const parsedLimit = Math.max(1, Math.min(100, Number(limit) || 24));
  const skip = (parsedPage - 1) * parsedLimit;

  const [packs, total] = await Promise.all([
    StickerPack.find(query).sort(sort).skip(skip).limit(parsedLimit).lean(),
    StickerPack.countDocuments(query),
  ]);

  const packIds = packs.map((p) => p._id);

  // Check installed state for user
  let installedSet = new Set();
  if (userId && packIds.length > 0) {
    const libraryItems = await UserStickerLibrary.find({
      userId,
      packId: { $in: packIds },
    })
      .select("packId")
      .lean();
    installedSet = new Set(libraryItems.map((li) => String(li.packId)));
  }

  // Fetch preview thumbnails for packs (up to 5 stickers per pack)
  const previewMap = new Map();
  if (packIds.length > 0) {
    const previewStickers = await Sticker.find({ packId: { $in: packIds } })
      .sort({ displayOrder: 1 })
      .lean();

    for (const stk of previewStickers) {
      const pId = String(stk.packId);
      if (!previewMap.has(pId)) {
        previewMap.set(pId, []);
      }
      if (previewMap.get(pId).length < 5) {
        previewMap.get(pId).push(normalizeSticker(stk));
      }
    }
  }

  const enhancedPacks = packs.map((p) => {
    const pId = String(p._id);
    const previews = previewMap.get(pId) || [];
    const cover = p.coverUrl || previews[0]?.url || "";
    return {
      ...p,
      coverUrl: cover,
      coverImage: cover,
      stickersCount: p.stickersCount || previews.length,
      previewStickers: previews,
      stickers: previews, // Backwards-compatible for card previews
      isInstalled: installedSet.has(pId),
    };
  });

  const totalPages = Math.ceil(total / parsedLimit);

  return {
    packs: enhancedPacks,
    pagination: {
      page: parsedPage,
      limit: parsedLimit,
      total,
      pages: totalPages,
      totalPages,
      hasMore: skip + packs.length < total,
    },
  };
};

/**
 * Fetches all stickers inside a pack.
 */
export const getPackDetails = async (packId, userId = null) => {
  const pack = await StickerPack.findById(packId).lean();
  if (!pack) throw new Error("Sticker pack not found");

  const stickers = await Sticker.find({ packId }).sort({ displayOrder: 1 }).lean();

  let isInstalled = false;
  if (userId) {
    isInstalled = Boolean(await UserStickerLibrary.exists({ userId, packId }));
  }

  const normalizedStickers = stickers.map((s) => normalizeSticker(s, pack.name));
  const cover = pack.coverUrl || normalizedStickers[0]?.url || "";

  return {
    ...pack,
    coverUrl: cover,
    coverImage: cover,
    stickersCount: pack.stickersCount || normalizedStickers.length,
    isInstalled,
    stickers: normalizedStickers,
  };
};

/**
 * Installs a sticker pack into the user's library.
 */
export const installPack = async (userId, packId) => {
  const pack = await StickerPack.findOne({
    _id: packId,
    status: PACK_STATUSES.PUBLISHED,
  });
  if (!pack) throw new Error("Pack not found or not published");

  // If paid pack, verify ownership
  if (pack.isPremium && pack.coinPrice > 0) {
    const hasPurchase = await StickerPurchase.exists({
      userId,
      packId,
      status: "completed",
    });
    if (!hasPurchase) {
      throw new Error("This is a premium pack. Please purchase it first.");
    }
  }

  const existing = await UserStickerLibrary.findOne({ userId, packId });
  if (existing) return existing;

  const userLibraryCount = await UserStickerLibrary.countDocuments({ userId });

  const installed = await UserStickerLibrary.create({
    userId,
    packId,
    displayOrder: userLibraryCount,
  });

  await StickerPack.findByIdAndUpdate(packId, { $inc: { installedCount: 1 } });

  // Trigger achievement evaluation for sticker installs
  await trackActivity(userId, "stickers_installed", 1);

  return installed;
};

/**
 * Removes a sticker pack from the user's library.
 */
export const uninstallPack = async (userId, packId) => {
  const removed = await UserStickerLibrary.findOneAndDelete({ userId, packId });
  if (removed) {
    await StickerPack.findByIdAndUpdate(packId, {
      $inc: { installedCount: -1 },
    });
  }
  return true;
};

/**
 * Purchases a premium sticker pack using wallet coins.
 */
export const purchasePack = async (userId, packId) => {
  const pack = await StickerPack.findOne({
    _id: packId,
    status: PACK_STATUSES.PUBLISHED,
  });
  if (!pack) throw new Error("Sticker pack not found");

  if (!pack.isPremium || pack.coinPrice <= 0) {
    // Free pack, simply install
    return installPack(userId, packId);
  }

  // Check if already purchased
  const alreadyPurchased = await StickerPurchase.findOne({
    userId,
    packId,
    status: "completed",
  });
  if (alreadyPurchased) {
    await installPack(userId, packId);
    return { purchased: true, alreadyOwned: true };
  }

  // Deduct coins from user's wallet
  const wallet = await Wallet.findOne({ userId });
  if (!wallet || wallet.balance < pack.coinPrice) {
    throw new Error(
      `Insufficient coins. Required: ${pack.coinPrice}, Available: ${wallet?.balance || 0}.`,
    );
  }

  wallet.balance -= pack.coinPrice;
  wallet.totalSpent += pack.coinPrice;
  await wallet.save();

  const transactionId = `stk_pur_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  await StickerPurchase.create({
    userId,
    packId,
    coinPrice: pack.coinPrice,
    transactionId,
    status: "completed",
  });

  await installPack(userId, packId);

  return {
    purchased: true,
    newBalance: wallet.balance,
  };
};

/**
 * Returns user's installed sticker packs along with their stickers.
 * If user library is completely empty, auto-installs the default starter pack so picker is never empty.
 */
export const getUserLibrary = async (userId) => {
  let libraryEntries = await UserStickerLibrary.find({ userId })
    .sort({ displayOrder: 1, installedAt: 1 })
    .populate("packId")
    .lean();

  // If user has no packs installed yet, auto-install starter packs
  if (libraryEntries.length === 0) {
    const starterPacks = await StickerPack.find({
      status: PACK_STATUSES.PUBLISHED,
      isPremium: false,
    })
      .sort({ displayOrder: 1 })
      .limit(2)
      .lean();

    for (let i = 0; i < starterPacks.length; i++) {
      try {
        await UserStickerLibrary.create({
          userId,
          packId: starterPacks[i]._id,
          displayOrder: i,
        });
        await StickerPack.findByIdAndUpdate(starterPacks[i]._id, {
          $inc: { installedCount: 1 },
        });
      } catch (_err) {}
    }

    libraryEntries = await UserStickerLibrary.find({ userId })
      .sort({ displayOrder: 1, installedAt: 1 })
      .populate("packId")
      .lean();
  }

  const validEntries = libraryEntries.filter((le) => le.packId);
  const packIds = validEntries.map((le) => le.packId._id);

  const allStickers = await Sticker.find({ packId: { $in: packIds } })
    .sort({ displayOrder: 1 })
    .lean();

  const stickersByPack = new Map();
  for (const s of allStickers) {
    const pId = String(s.packId);
    if (!stickersByPack.has(pId)) stickersByPack.set(pId, []);
    stickersByPack.get(pId).push(s);
  }

  return validEntries.map((le) => {
    const pack = le.packId;
    const packStickers = stickersByPack.get(String(pack._id)) || [];
    const normalized = packStickers.map((s) => normalizeSticker(s, pack.name));
    const cover = pack.coverUrl || normalized[0]?.url || "";

    return {
      _id: pack._id,
      id: String(pack._id),
      name: pack.name,
      slug: pack.slug,
      description: pack.description,
      coverUrl: cover,
      coverImage: cover,
      creatorName: pack.creatorName,
      category: pack.category,
      isAnimated: Boolean(pack.isAnimated),
      installedAt: le.installedAt,
      stickersCount: pack.stickersCount || normalized.length,
      stickers: normalized,
    };
  });
};

/**
 * Reorders user installed sticker packs.
 */
export const reorderInstalledPacks = async (userId, orderedPackIds) => {
  if (!Array.isArray(orderedPackIds)) return;

  const ops = orderedPackIds.map((packId, index) => ({
    updateOne: {
      filter: { userId, packId },
      update: { $set: { displayOrder: index } },
    },
  }));

  if (ops.length > 0) {
    await UserStickerLibrary.bulkWrite(ops);
  }
};

/**
 * Toggles sticker favorite state.
 */
export const toggleFavoriteSticker = async (userId, stickerId) => {
  const existing = await UserFavoriteSticker.findOne({ userId, stickerId });
  if (existing) {
    await UserFavoriteSticker.findByIdAndDelete(existing._id);
    return { favorited: false, isFavorited: false };
  }

  const sticker = await Sticker.findById(stickerId).lean();
  if (!sticker) throw new Error("Sticker not found");

  await UserFavoriteSticker.create({
    userId,
    stickerId,
    packId: sticker.packId,
  });

  return { favorited: true, isFavorited: true };
};

/**
 * Returns user favorite stickers.
 */
export const getFavoriteStickers = async (userId) => {
  const favorites = await UserFavoriteSticker.find({ userId })
    .sort({ favoritedAt: -1 })
    .populate("stickerId")
    .lean();

  return favorites
    .filter((f) => f.stickerId)
    .map((f) => normalizeSticker(f.stickerId));
};

/**
 * Records sticker usage and updates trending counters.
 */
export const recordStickerUsage = async (userId, stickerIdInput, conversationType = "direct") => {
  try {
    const stickerId =
      typeof stickerIdInput === "object"
        ? stickerIdInput?._id || stickerIdInput?.stickerId || stickerIdInput?.id
        : stickerIdInput;

    if (!stickerId || !mongoose.Types.ObjectId.isValid(String(stickerId))) return;

    const sticker = await Sticker.findById(stickerId).select("packId").lean();
    if (!sticker) return;

    await Promise.all([
      Sticker.findByIdAndUpdate(stickerId, { $inc: { usageCount: 1 } }),
      StickerPack.findByIdAndUpdate(sticker.packId, { $inc: { usageCount: 1 } }),
      StickerUsage.create({
        userId,
        stickerId,
        packId: sticker.packId,
        conversationType,
      }),
    ]);
  } catch (error) {
    console.error("[StickerMarketplace] recordStickerUsage error:", error?.message || error);
  }
};

/**
 * Returns user recently used stickers.
 */
export const getRecentStickers = async (userId, limit = 24) => {
  const usages = await StickerUsage.find({ userId })
    .sort({ usedAt: -1 })
    .limit(limit * 2)
    .populate("stickerId")
    .lean();

  const seen = new Set();
  const recents = [];

  for (const u of usages) {
    if (u.stickerId && !seen.has(String(u.stickerId._id))) {
      seen.add(String(u.stickerId._id));
      recents.push(normalizeSticker(u.stickerId));
      if (recents.length >= limit) break;
    }
  }

  return recents;
};

/**
 * Clears recently used stickers for a user.
 */
export const clearRecentStickers = async (userId) => {
  await StickerUsage.deleteMany({ userId });
  return true;
};

/**
 * Fetches curated Discover feed with featured, trending, popular, and fresh packs.
 */
export const getDiscoverFeed = async (userId = null) => {
  let installedSet = new Set();
  if (userId) {
    const libraryItems = await UserStickerLibrary.find({ userId })
      .select("packId")
      .lean();
    installedSet = new Set(libraryItems.map((li) => String(li.packId)));
  }

  const [featured, trending, popular, newest] = await Promise.all([
    StickerPack.find({ status: PACK_STATUSES.PUBLISHED, isFeatured: true })
      .sort({ displayOrder: 1, createdAt: -1 })
      .limit(6)
      .lean(),
    StickerPack.find({ status: PACK_STATUSES.PUBLISHED })
      .sort({ isTrending: -1, usageCount: -1, updatedAt: -1 })
      .limit(6)
      .lean(),
    StickerPack.find({ status: PACK_STATUSES.PUBLISHED })
      .sort({ installedCount: -1, usageCount: -1, displayOrder: 1 })
      .limit(6)
      .lean(),
    StickerPack.find({ status: PACK_STATUSES.PUBLISHED })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
  ]);

  const allPackIds = [
    ...new Set([
      ...featured.map((p) => p._id),
      ...trending.map((p) => p._id),
      ...popular.map((p) => p._id),
      ...newest.map((p) => p._id),
    ]),
  ];

  const previewMap = new Map();
  if (allPackIds.length > 0) {
    const previewStickers = await Sticker.find({ packId: { $in: allPackIds } })
      .sort({ displayOrder: 1 })
      .lean();

    for (const stk of previewStickers) {
      const pId = String(stk.packId);
      if (!previewMap.has(pId)) previewMap.set(pId, []);
      if (previewMap.get(pId).length < 5) {
        previewMap.get(pId).push(normalizeSticker(stk));
      }
    }
  }

  const formatPack = (p) => {
    const pId = String(p._id);
    const previews = previewMap.get(pId) || [];
    const cover = p.coverUrl || previews[0]?.url || "";
    return {
      ...p,
      coverUrl: cover,
      coverImage: cover,
      stickersCount: p.stickersCount || previews.length,
      previewStickers: previews,
      stickers: previews,
      isInstalled: installedSet.has(pId),
    };
  };

  return {
    featured: featured.map(formatPack),
    trending: trending.map(formatPack),
    popular: popular.map(formatPack),
    newest: newest.map(formatPack),
  };
};

/**
 * Returns categories enriched with real published pack counts and previews.
 */
export const getCategoriesWithCounts = async () => {
  const categories = await StickerCategory.find({ isActive: true })
    .sort({ displayOrder: 1 })
    .lean();

  const packCounts = await StickerPack.aggregate([
    { $match: { status: PACK_STATUSES.PUBLISHED } },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        packIds: { $push: "$_id" },
      },
    },
  ]);

  const countMap = new Map();
  const packIdsByCategory = new Map();
  for (const pc of packCounts) {
    if (pc._id) {
      const slugKey = String(pc._id).toLowerCase();
      countMap.set(slugKey, pc.count);
      packIdsByCategory.set(slugKey, pc.packIds);
    }
  }

  const enriched = await Promise.all(
    categories.map(async (cat) => {
      const slug = cat.slug?.toLowerCase();
      const packsCount = countMap.get(slug) || 0;
      const packIds = packIdsByCategory.get(slug) || [];
      let previewStickers = [];
      if (packIds.length > 0) {
        previewStickers = await Sticker.find({ packId: { $in: packIds } })
          .limit(4)
          .select("url thumbnailUrl name")
          .lean();
      }
      return {
        ...cat,
        packsCount,
        packCount: packsCount,
        previews: previewStickers.map((s) => s.thumbnailUrl || s.url),
      };
    }),
  );

  return enriched;
};

/**
 * Administrative Sticker Asset Integrity Diagnostic Report
 * Validates actual physical assets on disk, MIME types, accessibility, and database links.
 */
export const getStickerAssetIntegrityReport = async () => {
  const packs = await StickerPack.find({ status: PACK_STATUSES.PUBLISHED }).lean();
  const stickers = await Sticker.find().lean();

  const cwd = process.cwd();
  const publicDirs = [
    path.resolve(cwd, "server/public"),
    path.resolve(cwd, "client/public"),
    path.resolve(cwd, "public"),
  ];

  const fileExistsOnDisk = (assetUrl) => {
    if (!assetUrl || typeof assetUrl !== "string") return false;
    if (assetUrl.startsWith("http://") || assetUrl.startsWith("https://")) return true;
    
    const cleanRel = assetUrl.startsWith("/") ? assetUrl.slice(1) : assetUrl;
    for (const pDir of publicDirs) {
      const fullPath = path.resolve(pDir, cleanRel);
      if (fs.existsSync(fullPath)) return true;
    }
    return false;
  };

  let validStickerAssets = 0;
  let missingAssets = 0;
  let missingThumbnails = 0;
  let animatedStickers = 0;
  const brokenAssetUrls = [];
  const invalidFormats = [];
  const ALLOWED_FORMATS = new Set(["png", "webp", "gif", "svg"]);

  const packReport = packs.map((p) => {
    const packCoverValid = fileExistsOnDisk(p.coverUrl);
    if (!packCoverValid) {
      brokenAssetUrls.push({ type: "pack_cover", id: p._id, name: p.name, url: p.coverUrl });
    }
    const packStickers = stickers.filter((s) => String(s.packId) === String(p._id));
    let packMissingCount = 0;

    for (const s of packStickers) {
      const assetOk = fileExistsOnDisk(s.url);
      const thumbOk = fileExistsOnDisk(s.thumbnailUrl || s.url);
      if (assetOk) {
        validStickerAssets++;
      } else {
        missingAssets++;
        packMissingCount++;
        brokenAssetUrls.push({ type: "sticker", id: s._id, name: s.name, packName: p.name, url: s.url });
      }

      if (!thumbOk) missingThumbnails++;
      if (s.isAnimated || s.format === "gif") animatedStickers++;

      const ext = s.url ? path.extname(s.url).replace(".", "").toLowerCase() : "";
      if (ext && !ALLOWED_FORMATS.has(ext)) {
        invalidFormats.push({ id: s._id, name: s.name, format: ext });
      }
    }

    return {
      id: p._id,
      name: p.name,
      slug: p.slug,
      coverUrl: p.coverUrl,
      coverValid: packCoverValid,
      stickersCount: packStickers.length,
      missingStickers: packMissingCount,
      isComplete: packCoverValid && packMissingCount === 0 && packStickers.length > 0,
    };
  });

  const packsWithIncompleteArtwork = packReport.filter((p) => !p.isComplete).length;

  return {
    timestamp: new Date().toISOString(),
    totalPacks: packs.length,
    totalStickers: stickers.length,
    validStickerAssets,
    missingAssets,
    missingThumbnails,
    animatedStickers,
    invalidFormats: invalidFormats.length,
    packsWithIncompleteArtwork,
    brokenAssetUrls,
    packs: packReport,
  };
};
