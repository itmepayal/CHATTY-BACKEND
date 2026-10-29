import mongoose from "mongoose";

const LocationShareSchema = new mongoose.Schema(
  {
    sharerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },
    status: {
      type: String,
      enum: ["active", "stopped", "expired"],
      default: "active",
    },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    expiresAt: { type: Date, required: true },
    messageId: { type: mongoose.Schema.Types.ObjectId },
    lastLocation: {
      lat: Number,
      lng: Number,
      accuracy: Number,
      heading: Number,
      speed: Number,
      updatedAt: Date,
    },
  },
  { timestamps: true },
);

LocationShareSchema.pre("validate", function (next) {
  if (!!this.receiverId === !!this.groupId) {
    return next(
      new Error("Share must have exactly one of receiverId or groupId."),
    );
  }
  next();
});

LocationShareSchema.index({ status: 1, expiresAt: 1 });
LocationShareSchema.index({ sharerId: 1, receiverId: 1, status: 1 });
LocationShareSchema.index({ groupId: 1, sharerId: 1, status: 1 });

LocationShareSchema.index(
  { groupId: 1, sharerId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "active", groupId: { $exists: true } },
  },
);

export default mongoose.model("LocationShare", LocationShareSchema);
