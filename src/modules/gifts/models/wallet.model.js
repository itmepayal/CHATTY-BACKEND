import mongoose from "mongoose";

const WalletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    balance: {
      type: Number,
      required: true,
      default: 500, // Starter coins for all users
      min: 0,
    },
    totalSpent: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalReceived: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastDailyBonusClaim: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

const Wallet = mongoose.models.Wallet || mongoose.model("Wallet", WalletSchema);
export { Wallet };
export default Wallet;
