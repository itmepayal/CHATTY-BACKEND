import mongoose from "mongoose";

const StickerUsageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    stickerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sticker",
      required: true,
      index: true,
    },
    packId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StickerPack",
      required: true,
      index: true,
    },
    conversationType: {
      type: String,
      enum: ["direct", "group"],
      default: "direct",
    },
    usedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

StickerUsageSchema.index({ userId: 1, usedAt: -1 });

const StickerUsage =
  mongoose.models.StickerUsage ||
  mongoose.model("StickerUsage", StickerUsageSchema);
export { StickerUsage };
export default StickerUsage;
