import mongoose from "mongoose";

const GroupMessageSchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      validate: {
        validator: function (v) {
          if (!v) return true;
          return v.length <= (this.e2ee ? 24000 : 2000);
        },
        message: "Text is too long.",
      },
    },
    image: {
      public_id: { type: String },
      url: { type: String },
    },
    file: {
      public_id: { type: String },
      url: { type: String },
      name: { type: String },
      size: { type: Number },
      mimeType: { type: String },
      resourceType: { type: String },
    },
    audio: {
      public_id: { type: String },
      url: { type: String },
      duration: { type: Number },
      mimeType: { type: String },
      resourceType: { type: String },
    },
    video: {
      public_id: { type: String },
      url: { type: String },
      duration: { type: Number },
      mimeType: { type: String },
      resourceType: { type: String },
    },
    location: {
      lat: Number,
      lng: Number,
      accuracy: Number,
      isLive: { type: Boolean, default: false },
      shareId: { type: mongoose.Schema.Types.ObjectId, ref: "LocationShare" },
    },
    clientId: { type: String },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    silentReadBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    e2ee: { type: Boolean, default: false },
    iv: { type: String },
    keyVersion: { type: Number },
  },
  { timestamps: true },
);

GroupMessageSchema.pre("validate", function (next) {
  const hasLocation =
    Number.isFinite(this.location?.lat) && Number.isFinite(this.location?.lng);

  if (
    !this.text &&
    !this.image?.url &&
    !this.file?.url &&
    !this.audio?.url &&
    !this.video?.url &&
    !hasLocation
  ) {
    return next(
      new Error("Message must have text, an attachment or a location."),
    );
  }
  next();
});

GroupMessageSchema.index({ groupId: 1, createdAt: -1 });
GroupMessageSchema.index({ groupId: 1, senderId: 1, readBy: 1 });
GroupMessageSchema.index({ "location.shareId": 1 }, { sparse: true });

GroupMessageSchema.index(
  { groupId: 1, senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

const GroupMessage = mongoose.model("GroupMessage", GroupMessageSchema);
export default GroupMessage;
