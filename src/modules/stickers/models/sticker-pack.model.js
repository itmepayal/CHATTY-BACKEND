import mongoose from "mongoose";

export const PACK_STATUSES = Object.freeze({
  DRAFT: "draft",
  PENDING: "pending",
  PUBLISHED: "published",
  REJECTED: "rejected",
  DISABLED: "disabled",
});

const StickerPackSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      default: "",
      maxlength: 400,
    },
    coverUrl: {
      type: String,
      required: true,
    },
    creatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    creatorName: {
      type: String,
      required: true,
      default: "Chatty Creator",
    },
    category: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    tags: [
      {
        type: String,
        lowercase: true,
        trim: true,
      },
    ],
    isAnimated: {
      type: Boolean,
      default: false,
      index: true,
    },
    isPremium: {
      type: Boolean,
      default: false,
      index: true,
    },
    coinPrice: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(PACK_STATUSES),
      default: PACK_STATUSES.PUBLISHED,
      index: true,
    },
    rejectionReason: {
      type: String,
      default: "",
    },
    installedCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true,
    },
    rating: {
      type: Number,
      default: 5.0,
      min: 1.0,
      max: 5.0,
    },
    ratingCount: {
      type: Number,
      default: 1,
    },
    stickersCount: {
      type: Number,
      default: 0,
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    isTrending: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

StickerPackSchema.index({ status: 1, category: 1, displayOrder: 1 });
StickerPackSchema.index({ status: 1, isFeatured: 1, isTrending: 1 });
StickerPackSchema.index({ name: "text", description: "text", tags: "text" });

const StickerPack =
  mongoose.models.StickerPack ||
  mongoose.model("StickerPack", StickerPackSchema);
export { StickerPack };
export default StickerPack;
