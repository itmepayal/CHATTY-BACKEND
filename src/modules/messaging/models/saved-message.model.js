import mongoose from "mongoose";

const SavedMessageSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "messageModel",
      required: false,
      default: null,
    },
    messageModel: {
      type: String,
      enum: ["Message", "GroupMessage"],
      required: false,
      default: "Message",
    },
    chatType: {
      type: String,
      enum: ["direct", "group", "note"],
      required: true,
      default: "direct",
    },
    peerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      default: null,
    },
    category: {
      type: String,
      default: "Personal",
      index: true,
      trim: true,
    },
    folder: {
      type: String,
      default: "General",
      index: true,
      trim: true,
    },
    tags: [
      {
        type: String,
        trim: true,
      },
    ],
    note: {
      type: String,
      default: "",
      maxlength: 1000,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    cachedPreview: {
      text: { type: String, default: "" },
      senderName: { type: String, default: "" },
      mediaType: { type: String, default: "text" },
    },
  },
  { timestamps: true },
);

SavedMessageSchema.index({ userId: 1, messageId: 1 }, { unique: true });
SavedMessageSchema.index({ userId: 1, isPinned: -1, createdAt: -1 });
SavedMessageSchema.index({ userId: 1, category: 1, createdAt: -1 });
SavedMessageSchema.index({ userId: 1, folder: 1, createdAt: -1 });
SavedMessageSchema.index({ userId: 1, tags: 1 });

const SavedMessage = mongoose.model("SavedMessage", SavedMessageSchema);
export default SavedMessage;
