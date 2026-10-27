import mongoose from "mongoose";

const MessageSchema = mongoose.Schema(
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
    text: { type: String },
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
    clientId: { type: String },
    reactions: [
      {
        _id: false,
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        emoji: { type: String, required: true },
      },
    ],

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    isForwarded: { type: Boolean, default: false },

    isPinned: { type: Boolean, default: false },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pinnedAt: { type: Date },

    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date },

    linkPreview: {
      url: { type: String },
      title: { type: String },
      description: { type: String },
      image: { type: String },
      siteName: { type: String },
    },

    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },

    status: {
      type: String,
      enum: ["sent", "delivered", "seen"],
      default: "sent",
    },
    deliveredAt: { type: Date },
    seenAt: { type: Date },

    receiverReadAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

MessageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, sparse: true },
);

MessageSchema.index({ receiverId: 1, senderId: 1, status: 1, isDeleted: 1 });
MessageSchema.index({ receiverId: 1, status: 1 });
MessageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });

const Message = mongoose.model("Message", MessageSchema);
export default Message;
