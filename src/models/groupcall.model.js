import mongoose from "mongoose";

const GroupCallSchema = mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: { type: String, enum: ["audio", "video"], required: true },
    status: {
      type: String,
      enum: ["missed", "cancelled", "completed"],
      required: true,
    },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
    duration: { type: Number, default: 0 },
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    maxParticipants: { type: Number, default: 1 },
  },
  { timestamps: true },
);

GroupCallSchema.index({ groupId: 1, createdAt: -1 });

const GroupCall = mongoose.model("GroupCall", GroupCallSchema);
export default GroupCall;
