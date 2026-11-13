import mongoose from "mongoose";

const DeviceKeySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 128,
    },
    publicKey: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    deviceName: {
      type: String,
      trim: true,
      default: "Web Browser",
      maxlength: 100,
    },
    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

DeviceKeySchema.index({ userId: 1, deviceId: 1 }, { unique: true });
DeviceKeySchema.index({ userId: 1, isRevoked: 1 });

const DeviceKey = mongoose.model("DeviceKey", DeviceKeySchema);

export default DeviceKey;
