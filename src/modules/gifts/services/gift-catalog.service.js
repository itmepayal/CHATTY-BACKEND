import Gift from "../models/gift.model.js";
import Favorite from "../models/favorite.model.js";
import { GIFT_CATEGORIES } from "../data/gifts-catalog.data.js";
import ApiError from "../../../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";

/**
 * Retrieves paginated, filtered, and sorted gift catalog from DB.
 */
export const getGiftCatalog = async (query = {}, currentUserId = null) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 24));
  const skip = (page - 1) * limit;
  const userId = currentUserId || query.userId;

  const filter = { isActive: true };

  // Category & subcategory filter
  if (query.category && query.category !== "All" && query.category !== "all") {
    const rawCat = query.category.trim();
    const matchedCategory = GIFT_CATEGORIES.find(
      (c) =>
        c.id.toLowerCase() === rawCat.toLowerCase() ||
        c.name.toLowerCase() === rawCat.toLowerCase() ||
        c.folder.toLowerCase() === rawCat.toLowerCase() ||
        c.id.replace(/-/g, "").toLowerCase() === rawCat.replace(/-/g, "").toLowerCase()
    );
    if (matchedCategory) {
      filter.category = matchedCategory.name;
    } else {
      filter.category = new RegExp(`^${rawCat}$`, "i");
    }
  }
  if (query.subcategory) {
    filter.subcategory = query.subcategory.trim().toLowerCase();
  }

  // Boolean feature filters
  if (query.isAnimated === "true" || query.isAnimated === true) {
    filter.isAnimated = true;
  }
  if (query.isPremium === "true" || query.isPremium === true) {
    filter.isPremium = true;
  }
  if (query.isTrending === "true" || query.isTrending === true) {
    filter.isTrending = true;
  }
  if (query.isPopular === "true" || query.isPopular === true) {
    filter.isPopular = true;
  }
  if (query.isLimitedEdition === "true" || query.isLimitedEdition === true) {
    filter.isLimitedEdition = true;
  }
  if (query.isNew === "true" || query.isNew === true) {
    filter.isNew = true;
  }

  // Rarity filter
  if (query.rarity && query.rarity !== "all") {
    filter.rarity = query.rarity.toLowerCase();
  }

  // Price bounds
  if (query.minPrice != null && !isNaN(Number(query.minPrice))) {
    filter.coinPrice = { ...filter.coinPrice, $gte: Number(query.minPrice) };
  }
  if (query.maxPrice != null && !isNaN(Number(query.maxPrice))) {
    filter.coinPrice = { ...filter.coinPrice, $lte: Number(query.maxPrice) };
  }

  // Filter only favorites if requested
  if ((query.favoritesOnly === "true" || query.onlyFavorites === "true") && userId) {
    const userFavorites = await Favorite.find({ userId }).select("giftId").lean();
    const favIds = userFavorites.map((f) => f.giftId);
    filter._id = { $in: favIds };
  }

  // Search keyword (name, description, tags)
  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    filter.$or = [
      { name: new RegExp(term, "i") },
      { description: new RegExp(term, "i") },
      { tags: new RegExp(term, "i") },
    ];
  }

  // Sort configuration
  const sortKey = (query.sortBy || query.sort || "").toLowerCase();
  let sort = { displayOrder: 1, createdAt: -1 };
  if (sortKey === "price_asc" || sortKey === "cheapest") {
    sort = { coinPrice: 1, displayOrder: 1 };
  } else if (sortKey === "price_desc" || sortKey === "expensive" || sortKey === "most_expensive") {
    sort = { coinPrice: -1, displayOrder: 1 };
  } else if (sortKey === "newest") {
    sort = { createdAt: -1, displayOrder: 1 };
  } else if (sortKey === "popular" || sortKey === "popularity") {
    sort = { isPopular: -1, coinPrice: -1 };
  } else if (sortKey === "trending") {
    sort = { isTrending: -1, displayOrder: 1 };
  }

  // Fetch favorited IDs for current user to annotate
  let favoriteGiftIdSet = new Set();
  if (userId) {
    const userFavs = await Favorite.find({ userId }).select("giftId").lean();
    favoriteGiftIdSet = new Set(userFavs.map((f) => String(f.giftId)));
  }

  const [items, total] = await Promise.all([
    Gift.find(filter).sort(sort).skip(skip).limit(limit).lean(),
    Gift.countDocuments(filter),
  ]);

  const formatted = items.map((doc) => ({
    ...formatGift(doc),
    isFavorited: favoriteGiftIdSet.has(String(doc._id)),
  }));

  return {
    items: formatted,
    gifts: formatted,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
};

/**
 * Retrieves category breakdown with real-time active gift counts.
 */
export const getGiftCategories = async () => {
  const counts = await Gift.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
  ]);

  const countMap = {};
  for (const c of counts) {
    countMap[c._id] = c.count;
  }

  const result = GIFT_CATEGORIES.map((cat) => {
    const itemCount = countMap[cat.name] || countMap[cat.id] || 0;
    return {
      id: cat.id,
      name: cat.name,
      folder: cat.folder,
      icon: cat.icon,
      count: itemCount,
      itemCount,
      gradient: cat.gradient,
      accent: cat.accent,
    };
  });

  return result;
};

/**
 * Retrieves curated featured gifts for store highlights.
 */
export const getFeaturedGifts = async () => {
  const [trending, popular, limited, premium, newArrivals, luxury] = await Promise.all([
    Gift.find({ isActive: true, isTrending: true }).limit(8).lean(),
    Gift.find({ isActive: true, isPopular: true }).limit(8).lean(),
    Gift.find({ isActive: true, isLimitedEdition: true }).limit(8).lean(),
    Gift.find({ isActive: true, isPremium: true }).limit(8).lean(),
    Gift.find({ isActive: true, isNew: true }).limit(8).lean(),
    Gift.find({ isActive: true, rarity: { $in: ["epic", "legendary"] } }).limit(8).lean(),
  ]);

  return {
    trending: trending.map(formatGift),
    popular: popular.map(formatGift),
    limitedEdition: limited.map(formatGift),
    premium: premium.map(formatGift),
    newArrivals: newArrivals.map(formatGift),
    luxury: luxury.map(formatGift),
  };
};

/**
 * Retrieves a single gift by ID or slug.
 */
export const getGiftByIdOrSlug = async (idOrSlug) => {
  let gift = null;
  if (/^[0-9a-fA-F]{24}$/.test(idOrSlug)) {
    gift = await Gift.findById(idOrSlug).lean();
  }
  if (!gift) {
    gift = await Gift.findOne({ slug: idOrSlug.toLowerCase() }).lean();
  }
  if (!gift) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Gift not found in catalog.");
  }
  return formatGift(gift);
};

/**
 * Admin: Creates a new gift entry in the catalog.
 */
export const createGift = async (data) => {
  if (!data.name || !data.category || !data.coinPrice) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Name, category, and coinPrice are required.",
    );
  }
  const slug = (data.slug || data.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const existing = await Gift.findOne({ slug });
  if (existing) {
    throw new ApiError(StatusCodes.CONFLICT, "A gift with this slug already exists.");
  }

  const gift = await Gift.create({
    ...data,
    slug,
  });

  return formatGift(gift);
};

/**
 * Admin: Updates an existing gift.
 */
export const updateGift = async (idOrSlug, updates) => {
  const query = /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: idOrSlug.toLowerCase() };
  const gift = await Gift.findOne(query);
  if (!gift) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Gift not found.");
  }

  // Prevent modifying slug
  delete updates.slug;

  Object.assign(gift, updates);
  await gift.save();

  return formatGift(gift);
};

/**
 * Admin: Toggles or deactivates a gift.
 */
export const deleteGift = async (idOrSlug) => {
  const query = /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: idOrSlug.toLowerCase() };
  const gift = await Gift.findOne(query);
  if (!gift) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Gift not found.");
  }
  gift.isActive = false;
  await gift.save();
  return { message: "Gift deactivated successfully.", id: gift._id };
};

/**
 * Toggles a gift as favorite for a user.
 */
export const toggleFavorite = async (userId, idOrSlug) => {
  const query = /^[0-9a-fA-F]{24}$/.test(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: idOrSlug.toLowerCase() };
  const gift = await Gift.findOne(query);
  if (!gift) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Gift not found.");
  }

  const existing = await Favorite.findOne({ userId, giftId: gift._id });
  if (existing) {
    await Favorite.deleteOne({ _id: existing._id });
    return {
      isFavorited: false,
      giftId: String(gift._id),
      giftSlug: gift.slug,
      gift: { ...formatGift(gift), isFavorited: false },
    };
  }

  await Favorite.create({
    userId,
    giftId: gift._id,
    giftSlug: gift.slug,
  });

  return {
    isFavorited: true,
    giftId: String(gift._id),
    giftSlug: gift.slug,
    gift: { ...formatGift(gift), isFavorited: true },
  };
};

/**
 * Retrieves all favorited gifts for a user.
 */
export const getUserFavorites = async (userId) => {
  const favorites = await Favorite.find({ userId })
    .sort({ createdAt: -1 })
    .populate("giftId")
    .lean();

  const gifts = favorites
    .filter((fav) => fav.giftId && fav.giftId.isActive !== false)
    .map((fav) => ({
      ...formatGift(fav.giftId),
      isFavorited: true,
      favoritedAt: fav.createdAt,
    }));

  return gifts;
};

/**
 * Normalizes gift document for consistent web and mobile client payloads.
 */
export const formatGift = (doc) => {
  if (!doc) return null;
  return {
    id: String(doc._id || doc.id),
    _id: String(doc._id || doc.id),
    name: doc.name,
    slug: doc.slug,
    description: doc.description || "",
    category: doc.category,
    subcategory: doc.subcategory || "",
    tags: doc.tags || [],
    coinPrice: doc.coinPrice,
    icon: doc.icon || "🎁",
    image: doc.image,
    thumbnail: doc.thumbnail || doc.image,
    animationAsset: doc.animationAsset || "",
    assetType: doc.assetType || "svg",
    isAnimated: Boolean(doc.isAnimated),
    isPremium: Boolean(doc.isPremium),
    isPopular: Boolean(doc.isPopular),
    isTrending: Boolean(doc.isTrending),
    isLimitedEdition: Boolean(doc.isLimitedEdition),
    isNew: Boolean(doc.isNew),
    isActive: Boolean(doc.isActive),
    displayOrder: doc.displayOrder || 0,
    rarity: doc.rarity || "common",
    gradient: doc.gradient || ["#8b5cf6", "#6d28d9"],
    badge: doc.badge || (doc.rarity ? doc.rarity.toUpperCase() : "COMMON"),
    color: doc.color || "",
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
};
