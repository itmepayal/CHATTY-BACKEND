import mongoose from "mongoose";

const UserGiftSchema = new mongoose.Schema(
  {
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      required: true,
    },
    gift: {
      id: { type: String },
      name: { type: String, required: true },
      slug: { type: String, required: true },
      icon: { type: String, default: "🎁" },
      image: { type: String, required: true },
      category: { type: String, required: true },
      coinPrice: { type: Number, required: true },
      rarity: { type: String, default: "common" },
    },
    personalMessage: {
      type: String,
      default: "",
      maxlength: 200,
    },
    chatType: {
      type: String,
      enum: ["direct", "group"],
      default: "direct",
    },
    targetId: {
      type: String,
      default: "",
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    isPinnedToProfile: {
      type: Boolean,
      default: false,
      index: true,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

UserGiftSchema.index({ recipientId: 1, createdAt: -1 });
UserGiftSchema.index({ senderId: 1, createdAt: -1 });

const UserGift =
  mongoose.models.UserGift || mongoose.model("UserGift", UserGiftSchema);
export default UserGift;
