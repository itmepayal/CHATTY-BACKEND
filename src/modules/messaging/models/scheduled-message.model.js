import mongoose from "mongoose";
import { MAX_CIPHERTEXT_LENGTH } from "../constants/messages.constants.js";

const ScheduledMessageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    messageType: {
      type: String,
      enum: ["direct", "group"],
      default: "direct",
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return this.messageType === "direct";
      },
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: function () {
        return this.messageType === "group";
      },
    },
    text: { type: String, required: true, maxlength: MAX_CIPHERTEXT_LENGTH },
    e2ee: { type: Boolean, default: false },
    iv: { type: String, default: null },
    keyEnvelopes: [
      {
        _id: false,
        deviceId: { type: String, required: true },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        wrappedKey: { type: String, required: true, maxlength: 2048 },
        iv: { type: String, required: true },
      },
    ],
    groupKeyVersion: { type: Number, default: null },
    clientRequestId: { type: String, sparse: true, index: true },
    scheduledFor: { type: Date, required: true },
    status: {
      type: String,
      enum: [
        "pending",
        "scheduled",
        "processing",
        "sent",
        "failed",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },
    processingStartedAt: { type: Date, default: null },
    retryCount: { type: Number, default: 0 },
    error: { type: String, default: null },
    sentMessageId: { type: mongoose.Schema.Types.ObjectId },
  },
  { timestamps: true },
);

ScheduledMessageSchema.index({ status: 1, scheduledFor: 1 });
ScheduledMessageSchema.index({ senderId: 1, status: 1, scheduledFor: 1 });
ScheduledMessageSchema.index({ receiverId: 1, status: 1 });
ScheduledMessageSchema.index({ groupId: 1, status: 1 });

const ScheduledMessage = mongoose.model(
  "ScheduledMessage",
  ScheduledMessageSchema,
);
export default ScheduledMessage;
