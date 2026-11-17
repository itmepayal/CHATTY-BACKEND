import mongoose from "mongoose";

const GroupInviteSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
      index: true,
    },
    inviterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    inviteeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "expired"],
      default: "pending",
      index: true,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 72 * 60 * 60 * 1000), // 3 days
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

GroupInviteSchema.index({ groupId: 1, inviteeId: 1, status: 1 });

const GroupInvite = mongoose.model("GroupInvite", GroupInviteSchema);

export default GroupInvite;
