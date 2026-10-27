import mongoose from "mongoose";

const CallSchema = mongoose.Schema(
  {
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: { type: String, enum: ["audio", "video"], required: true },
    status: {
      type: String,
      enum: ["missed", "rejected", "cancelled", "completed", "failed"],
      required: true,
    },
    startedAt: { type: Date, required: true },
    answeredAt: { type: Date },
    endedAt: { type: Date },
    duration: { type: Number, default: 0 },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

CallSchema.index({ callerId: 1, createdAt: -1 });
CallSchema.index({ receiverId: 1, createdAt: -1 });

const Call = mongoose.model("Call", CallSchema);
export default Call;
