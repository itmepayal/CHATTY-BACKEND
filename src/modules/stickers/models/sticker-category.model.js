import mongoose from "mongoose";

const StickerCategorySchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      default: "Smile",
    },
    description: {
      type: String,
      default: "",
    },
    displayOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

const StickerCategory =
  mongoose.models.StickerCategory ||
  mongoose.model("StickerCategory", StickerCategorySchema);
export { StickerCategory };
export default StickerCategory;
