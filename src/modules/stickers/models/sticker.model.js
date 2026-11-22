import mongoose from "mongoose";

const StickerSchema = new mongoose.Schema(
  {
    packId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StickerPack",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    url: {
      type: String,
      required: true,
    },
    thumbnailUrl: {
      type: String,
      default: "",
    },
    altText: {
      type: String,
      default: "",
    },
    keywords: [
      {
        type: String,
        lowercase: true,
        trim: true,
      },
    ],
    format: {
      type: String,
      enum: ["png", "webp", "gif", "svg"],
      default: "webp",
    },
    isAnimated: {
      type: Boolean,
      default: false,
    },
    width: {
      type: Number,
      default: 256,
    },
    height: {
      type: Number,
      default: 256,
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

StickerSchema.index({ packId: 1, displayOrder: 1 });
StickerSchema.index({ keywords: 1 });

const Sticker =
  mongoose.models.Sticker || mongoose.model("Sticker", StickerSchema);
export { Sticker };
export default Sticker;
