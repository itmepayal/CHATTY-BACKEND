import mongoose from "mongoose";

const ReportSchema = new mongoose.Schema(
  {
    reporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportedUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    messageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
    reason: {
      type: String,
      enum: ["spam", "harassment", "inappropriate", "impersonation", "other"],
      required: true,
    },
    details: { type: String, maxlength: 500 },
    status: {
      type: String,
      enum: ["pending", "reviewed", "dismissed"],
      default: "pending",
    },
  },
  { timestamps: true },
);

ReportSchema.index({ reporterId: 1, reportedUserId: 1, createdAt: -1 });
ReportSchema.index({ reportedUserId: 1, status: 1 });

const Report = mongoose.model("Report", ReportSchema);
export default Report;
