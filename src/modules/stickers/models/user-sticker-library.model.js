import mongoose from "mongoose";

const UserStickerLibrarySchema = new mongoose.Schema(
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
    installedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

UserStickerLibrarySchema.index({ userId: 1, packId: 1 }, { unique: true });
UserStickerLibrarySchema.index({ userId: 1, displayOrder: 1 });

const UserStickerLibrary =
  mongoose.models.UserStickerLibrary ||
  mongoose.model("UserStickerLibrary", UserStickerLibrarySchema);
export { UserStickerLibrary };
export default UserStickerLibrary;
