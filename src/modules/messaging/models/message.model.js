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
        createdAt: { type: Date, default: Date.now },
      },
    ],

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    parentMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
      index: true,
    },
    threadReplyCount: { type: Number, default: 0 },
    threadLastReplyAt: { type: Date, default: null },
    threadParticipants: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    poll: {
      question: { type: String },
      type: { type: String, enum: ["single", "multiple"], default: "single" },
      options: [
        {
          _id: {
            type: mongoose.Schema.Types.ObjectId,
            default: () => new mongoose.Types.ObjectId(),
          },
          text: { type: String, required: true },
          votes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        },
      ],
      isAnonymous: { type: Boolean, default: false },
      allowMultipleAnswers: { type: Boolean, default: false },
      canChangeVote: { type: Boolean, default: true },
      isClosed: { type: Boolean, default: false },
      isEnded: { type: Boolean, default: false },
      closedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      closedAt: { type: Date },
      endedAt: { type: Date },
      createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      expiresAt: { type: Date, default: null },
    },

    gift: {
      id: { type: String },
      giftId: { type: String },
      slug: { type: String },
      name: { type: String },
      icon: { type: String },
      image: { type: String },
      category: { type: String },
      coinPrice: { type: Number, default: 0 },
      rarity: { type: String, default: "common" },
      badge: { type: String, default: "" },
      isAnimated: { type: Boolean, default: false },
      animation: { type: String },
      color: { type: String },
      message: { type: String },
      senderName: { type: String },
    },
    messageType: {
      type: String,
      enum: ["text", "image", "file", "audio", "video", "location", "poll", "gift"],
      default: "text",
    },

    isViewOnce: { type: Boolean, default: false },
    viewOnceViewedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    viewOnceExpired: { type: Boolean, default: false },
    isForwarded: { type: Boolean, default: false },

    isPinned: { type: Boolean, default: false },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pinnedAt: { type: Date },

    starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

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

    location: {
      lat: { type: Number },
      lng: { type: Number },
      accuracy: { type: Number },
      isLive: { type: Boolean, default: false },
      shareId: { type: mongoose.Schema.Types.ObjectId, ref: "LocationShare" },
    },

    deliveredAt: { type: Date },
    seenAt: { type: Date },

    e2ee: { type: Boolean, default: false },
    iv: { type: String },
    keyEnvelopes: [
      {
        _id: false,
        deviceId: { type: String, required: true },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        wrappedKey: { type: String, required: true, maxlength: 2048 },
        iv: { type: String, required: true },
      },
    ],

    receiverReadAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

MessageSchema.index(
  { senderId: 1, clientId: 1 },
  {
    unique: true,
    partialFilterExpression: { clientId: { $type: "string" } },
  },
);

MessageSchema.index({ expiresAt: 1, isDeleted: 1 });

MessageSchema.index({ receiverId: 1, senderId: 1, status: 1, isDeleted: 1 });
MessageSchema.index({ receiverId: 1, status: 1 });
MessageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
MessageSchema.index({ senderId: 1, createdAt: -1 });
MessageSchema.index({ receiverId: 1, createdAt: -1 });

const Message = mongoose.model("Message", MessageSchema);

export default Message;
