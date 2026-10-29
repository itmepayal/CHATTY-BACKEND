import mongoose from "mongoose";

const LocationShareSchema = new mongoose.Schema(
  {
    sharerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "stopped", "expired"],
      default: "active",
    },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    lastLocation: {
      lat: Number,
      lng: Number,
      accuracy: Number,
      heading: Number,
      speed: Number,
      updatedAt: Date,
    },
  },
  { timestamps: true },
);

LocationShareSchema.index({ status: 1, expiresAt: 1 });
LocationShareSchema.index({ sharerId: 1, receiverId: 1, status: 1 });

export default mongoose.model("LocationShare", LocationShareSchema);
