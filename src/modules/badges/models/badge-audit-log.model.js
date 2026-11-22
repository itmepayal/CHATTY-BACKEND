import mongoose from "mongoose";

const BadgeAuditLogSchema = new mongoose.Schema(
  {
    badgeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Badge",
      index: true,
    },
    badgeSlug: {
      type: String,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        "manual_award",
        "manual_revoke",
        "create_badge",
        "update_badge",
        "delete_badge",
      ],
      required: true,
      index: true,
    },
    reason: {
      type: String,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

BadgeAuditLogSchema.index({ userId: 1, action: 1 });
BadgeAuditLogSchema.index({ adminId: 1, createdAt: -1 });

const BadgeAuditLog =
  mongoose.models.BadgeAuditLog ||
  mongoose.model("BadgeAuditLog", BadgeAuditLogSchema);
export { BadgeAuditLog };
export default BadgeAuditLog;
