import mongoose from "mongoose";

const GiftSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
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
      trim: true,
    },
    category: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    subcategory: {
      type: String,
      default: "",
      trim: true,
    },
    tags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    coinPrice: {
      type: Number,
      required: true,
      min: 1,
      default: 25,
      index: true,
    },
    icon: {
      type: String,
      default: "🎁",
    },
    image: {
      type: String,
      required: true,
    },
    thumbnail: {
      type: String,
      default: "",
    },
    animationAsset: {
      type: String,
      default: "",
    },
    assetType: {
      type: String,
      enum: ["svg", "animated_svg", "png", "webp", "lottie"],
      default: "svg",
    },
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
    isPopular: {
      type: Boolean,
      default: false,
      index: true,
    },
    isTrending: {
      type: Boolean,
      default: false,
      index: true,
    },
    isLimitedEdition: {
      type: Boolean,
      default: false,
      index: true,
    },
    isNew: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    rarity: {
      type: String,
      enum: ["common", "rare", "epic", "legendary", "mythic"],
      default: "common",
      index: true,
    },
    gradient: [
      {
        type: String,
      },
    ],
    badge: {
      type: String,
      default: "",
    },
    color: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  },
);

GiftSchema.index({ category: 1, isActive: 1, displayOrder: 1 });
GiftSchema.index({ name: "text", description: "text", tags: "text" });

const Gift = mongoose.models.Gift || mongoose.model("Gift", GiftSchema);
export { Gift };
export default Gift;
