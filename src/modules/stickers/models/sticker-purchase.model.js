import mongoose from "mongoose";

const StickerPurchaseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    packId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StickerPack",
      required: true,
      index: true,
    },
    coinPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["completed", "refunded"],
      default: "completed",
      index: true,
    },
    purchasedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

StickerPurchaseSchema.index(
  { userId: 1, packId: 1, status: 1 },
  { unique: true },
);

const StickerPurchase =
  mongoose.models.StickerPurchase ||
  mongoose.model("StickerPurchase", StickerPurchaseSchema);
export { StickerPurchase };
export default StickerPurchase;
