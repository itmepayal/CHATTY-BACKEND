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
      ref: "GroupMessage",
      default: null,
    },
    parentMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupMessage",
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
    expiresAt: { type: Date, default: null },

    e2ee: { type: Boolean, default: false },
    iv: { type: String },
    keyVersion: { type: Number },

    isEdited: { type: Boolean, default: false },
    editedAt: { type: Date },

    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "GroupMessage",
      default: null,
    },
    isForwarded: { type: Boolean, default: false },

    isPinned: { type: Boolean, default: false },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    pinnedAt: { type: Date },

    starredBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    mentionAll: { type: Boolean, default: false },

    mentions: [
      {
        _id: false,
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        startIndex: { type: Number, default: 0 },
        length: { type: Number, default: 0 },
      },
    ],

    deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

GroupMessageSchema.pre("validate", function (next) {
  if (this.isDeleted) return next();

  const hasLocation =
    Number.isFinite(this.location?.lat) && Number.isFinite(this.location?.lng);

  if (
    !this.text &&
    !this.image?.url &&
    !this.file?.url &&
    !this.audio?.url &&
    !this.video?.url &&
    !hasLocation &&
    !this.poll?.question &&
    !this.gift?.name
  ) {
    return next(
      new Error("Message must have text, an attachment or a location."),
    );
  }
  next();
});

GroupMessageSchema.index({ groupId: 1, createdAt: -1 });
GroupMessageSchema.index({ groupId: 1, senderId: 1, readBy: 1 });
GroupMessageSchema.index({ groupId: 1, isPinned: 1, pinnedAt: -1 });
GroupMessageSchema.index({ "mentions.userId": 1, groupId: 1 });
GroupMessageSchema.index({ "location.shareId": 1 }, { sparse: true });

GroupMessageSchema.index(
  { groupId: 1, senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

const GroupMessage = mongoose.model("GroupMessage", GroupMessageSchema);
export default GroupMessage;
