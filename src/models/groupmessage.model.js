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
    text: { type: String, maxlength: 2000 },
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
    clientId: { type: String },
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    silentReadBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

GroupMessageSchema.pre("validate", function (next) {
  if (!this.text && !this.image?.url && !this.file?.url && !this.audio?.url) {
    return next(new Error("Message must have text or an attachment."));
  }
  next();
});

GroupMessageSchema.index({ groupId: 1, createdAt: -1 });
GroupMessageSchema.index({ groupId: 1, senderId: 1, readBy: 1 });

GroupMessageSchema.index(
  { groupId: 1, senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

const GroupMessage = mongoose.model("GroupMessage", GroupMessageSchema);
export default GroupMessage;
