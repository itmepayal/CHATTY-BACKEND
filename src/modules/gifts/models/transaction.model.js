import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["gift_sent", "gift_received", "bonus", "admin_credit", "refund"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },
    giftId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Gift",
      default: null,
    },
    giftName: {
      type: String,
      default: "",
    },
    giftIcon: {
      type: String,
      default: "",
    },
    giftImage: {
      type: String,
      default: "",
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
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
    status: {
      type: String,
      enum: ["completed", "failed", "pending"],
      default: "completed",
      index: true,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

TransactionSchema.index({ userId: 1, createdAt: -1 });

const Transaction =
  mongoose.models.Transaction || mongoose.model("Transaction", TransactionSchema);
export default Transaction;
