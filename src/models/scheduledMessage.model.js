import mongoose from "mongoose";

const ScheduledMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: { type: String, required: true, maxlength: 4000 },
    scheduledFor: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "sent", "failed", "cancelled"],
      default: "pending",
    },
    error: { type: String },
    sentMessageId: { type: mongoose.Schema.Types.ObjectId, ref: "Message" },
  },
  { timestamps: true },
);

ScheduledMessageSchema.index({ status: 1, scheduledFor: 1 });
ScheduledMessageSchema.index({ senderId: 1, status: 1, scheduledFor: 1 });

const ScheduledMessage = mongoose.model(
  "ScheduledMessage",
  ScheduledMessageSchema,
);
export default ScheduledMessage;
