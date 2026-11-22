import mongoose from "mongoose";

const UserFavoriteStickerSchema = new mongoose.Schema(
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
    },
    favoritedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

UserFavoriteStickerSchema.index({ userId: 1, stickerId: 1 }, { unique: true });

const UserFavoriteSticker =
  mongoose.models.UserFavoriteSticker ||
  mongoose.model("UserFavoriteSticker", UserFavoriteStickerSchema);
export { UserFavoriteSticker };
export default UserFavoriteSticker;
