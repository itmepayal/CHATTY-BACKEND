import mongoose from "mongoose";

const FavoriteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: true,
      index: true,
    },
    giftSlug: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

FavoriteSchema.index({ userId: 1, giftId: 1 }, { unique: true });
FavoriteSchema.index({ userId: 1, createdAt: -1 });

const Favorite =
  mongoose.models.Favorite || mongoose.model("GiftFavorite", FavoriteSchema);

export { Favorite };
export default Favorite;
