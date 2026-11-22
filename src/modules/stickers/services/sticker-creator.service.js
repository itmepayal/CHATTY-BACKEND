import StickerPack, { PACK_STATUSES } from "../models/sticker-pack.model.js";
import Sticker from "../models/sticker.model.js";
import User from "../../users/models/users.model.js";
import { uploadFileToCloudinary } from "../../../infrastructure/cloudinary/cloudinary.config.js";
import { io } from "../../../infrastructure/socket/socket.js";
import { dispatchNotification } from "../../notifications/services/notification.service.js";
import { NOTIFICATION_TYPES } from "../../notifications/models/notification.model.js";

/**
 * Creates a new draft sticker pack.
 */
export const createPack = async (
  creatorId,
  { name, description, category, tags, coverUrl, isPremium, coinPrice },
) => {
  const creator = await User.findById(creatorId)
    .select("fullName username")
    .lean();
  const creatorName = creator?.fullName || creator?.username || "Creator";

  const slug = `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")}-${Date.now().toString(36)}`;

  const pack = await StickerPack.create({
    name: name.trim(),
    slug,
    description: (description || "").trim(),
    category: (category || "custom").toLowerCase().trim(),
    tags: Array.isArray(tags)
      ? tags
      : typeof tags === "string"
        ? tags.split(",").map((t) => t.trim().toLowerCase())
        : [],
    coverUrl:
      coverUrl ||
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=300&q=80",
    creatorId,
    creatorName,
    isPremium: Boolean(isPremium),
    coinPrice: isPremium ? Math.max(0, Number(coinPrice) || 0) : 0,
    status: PACK_STATUSES.DRAFT,
  });

  return pack;
};

/**
 * Uploads stickers into an existing draft or pending pack.
 */
export const addStickersToPack = async (
  creatorId,
  packId,
  files = [],
  stickerMeta = [],
) => {
  const pack = await StickerPack.findById(packId);
  if (!pack) throw new Error("Sticker pack not found");
  if (String(pack.creatorId) !== String(creatorId)) {
    throw new Error("Unauthorized: You do not own this sticker pack");
  }

  const existingCount = await Sticker.countDocuments({ packId });
  const createdStickers = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const meta = stickerMeta[i] || {};

    let assetUrl = meta.url;
    if (file?.path) {
      try {
        const uploaded = await uploadFileToCloudinary(file.path);
        assetUrl = uploaded?.secure_url || uploaded?.url;
      } catch (err) {
        console.error("[StickerCreator] Cloudinary upload error:", err?.message || err);
      }

      if (!assetUrl && file.filename) {
        assetUrl = `/public/upload/${file.filename}`;
      }
    }

    if (!assetUrl) continue;

    const isAnimated =
      file?.mimetype?.includes("gif") ||
      file?.mimetype?.includes("webp") ||
      Boolean(meta.isAnimated);

    const sticker = await Sticker.create({
      packId,
      name: meta.name || `Sticker ${existingCount + i + 1}`,
      url: assetUrl,
      thumbnailUrl: assetUrl,
      altText: meta.altText || meta.name || `Sticker ${existingCount + i + 1}`,
      keywords: Array.isArray(meta.keywords) ? meta.keywords : [],
      isAnimated,
      displayOrder: existingCount + i,
    });

    createdStickers.push(sticker);
  }

  // Update pack sticker counter
  pack.stickersCount = await Sticker.countDocuments({ packId });
  if (
    pack.coverUrl ===
      "https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=300&q=80" &&
    createdStickers[0]?.url
  ) {
    pack.coverUrl = createdStickers[0].url;
  }
  await pack.save();

  return createdStickers;
};

/**
 * Submits a pack for moderation review.
 */
export const submitPackForReview = async (creatorId, packId) => {
  const pack = await StickerPack.findById(packId);
  if (!pack) throw new Error("Sticker pack not found");
  if (String(pack.creatorId) !== String(creatorId)) {
    throw new Error("Unauthorized: You do not own this sticker pack");
  }

  const stickerCount = await Sticker.countDocuments({ packId });
  if (stickerCount < 3) {
    throw new Error(
      "A sticker pack must contain at least 3 stickers before submission.",
    );
  }

  pack.status = PACK_STATUSES.PENDING;
  pack.stickersCount = stickerCount;
  await pack.save();

  return pack;
};

/**
 * Fetches creator's own sticker packs.
 */
export const getMyCreatorPacks = async (creatorId) => {
  const packs = await StickerPack.find({ creatorId })
    .sort({ createdAt: -1 })
    .lean();
  return packs;
};

/**
 * Admin: Moderates a sticker pack (approve/publish, reject, disable).
 */
export const adminUpdatePackStatus = async (
  adminId,
  packId,
  { status, rejectionReason = "" },
) => {
  const pack = await StickerPack.findById(packId);
  if (!pack) throw new Error("Sticker pack not found");

  pack.status = status;
  if (rejectionReason) pack.rejectionReason = rejectionReason;
  await pack.save();

  if (status === PACK_STATUSES.PUBLISHED) {
    // Notify creator
    try {
      await dispatchNotification({
        recipientId: pack.creatorId,
        senderId: adminId,
        category: "sticker",
        type: NOTIFICATION_TYPES.STICKER_PACK_PUBLISHED,
        title: "Sticker Pack Published! 🎨",
        body: `Congratulations! Your sticker pack "${pack.name}" has been approved and is now live in the Marketplace!`,
        data: { packId: String(pack._id) },
      });
    } catch (_e) {}

    // Broadcast marketplace update
    if (io) {
      io.emit("sticker:pack:published", {
        packId: pack._id,
        name: pack.name,
        category: pack.category,
      });
    }
  }

  return pack;
};

/**
 * Admin: List pending review packs.
 */
export const adminGetPendingPacks = async () => {
  const pendingPacks = await StickerPack.find({ status: PACK_STATUSES.PENDING })
    .sort({ updatedAt: 1 })
    .populate("creatorId", "fullName username email avatar")
    .lean();
  return pendingPacks;
};
