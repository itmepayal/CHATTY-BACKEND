import mongoose from "mongoose";

const SessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    device: {
      browser: { type: String, default: "Unknown browser" },
      os: { type: String, default: "Unknown OS" },
      label: { type: String, default: "Unknown device" },
      type: { type: String, default: "desktop" },
    },
    ip: { type: String, default: "Unknown" },
    location: { type: String, default: "Location unavailable" },
    lastActivity: { type: Date, default: Date.now },
    revoked: { type: Boolean, default: false, index: true },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  { timestamps: true },
);

SessionSchema.index({ userId: 1, revoked: 1, expiresAt: 1 });

const Session = mongoose.model("Session", SessionSchema);

export default Session;
