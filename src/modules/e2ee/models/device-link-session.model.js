import mongoose from "mongoose";

const DeviceLinkSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    linkSessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    linkingPin: {
      type: String,
      required: true,
      index: true,
    },
    ephemeralPublicKey: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    newDeviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    newDeviceName: {
      type: String,
      trim: true,
      default: "New Device",
      maxlength: 100,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "expired"],
      default: "pending",
      index: true,
    },
    encryptedPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    approverDeviceId: {
      type: String,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: true,
  },
);

DeviceLinkSessionSchema.index({ userId: 1, linkingPin: 1 });
DeviceLinkSessionSchema.index({ userId: 1, status: 1 });

const DeviceLinkSession = mongoose.model(
  "DeviceLinkSession",
  DeviceLinkSessionSchema,
);

export default DeviceLinkSession;
