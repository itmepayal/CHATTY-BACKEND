import mongoose from "mongoose";

const StoryViewSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    viewedAt: {
      type: Date,
      default: Date.now,
    },
    reaction: {
      type: String,
      default: null,
      trim: true,
    },
    reactedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const StorySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Story owner is required."],
      index: true,
    },
    mediaType: {
      type: String,
      enum: ["image", "video", "text"],
      required: [true, "Media type is required."],
      default: "text",
    },
    mediaUrl: {
      type: String,
      default: "",
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      default: "",
      trim: true,
    },
    mediaPublicId: {
      type: String,
      default: "",
      trim: true,
    },
    duration: {
      type: Number,
      default: 5,
    },
    textContent: {
      type: String,
      maxlength: [500, "Text content cannot exceed 500 characters."],
      default: "",
    },
    caption: {
      type: String,
      maxlength: [300, "Caption cannot exceed 300 characters."],
      default: "",
    },
    textAlignment: {
      type: String,
      enum: ["left", "center", "right"],
      default: "center",
    },
    textSize: {
      type: String,
      enum: ["sm", "md", "lg", "xl"],
      default: "lg",
    },
    overlays: [
      {
        _id: false,
        id: { type: String },
        type: { type: String, enum: ["text", "emoji"], default: "text" },
        content: { type: String, default: "" },
        x: { type: Number, default: 50 },
        y: { type: Number, default: 50 },
        scale: { type: Number, default: 1 },
        color: { type: String, default: "#FFFFFF" },
        font: { type: String, default: "sans" },
        rotation: { type: Number, default: 0 },
      },
    ],
    background: {
      type: {
        type: String,
        enum: ["color", "gradient"],
        default: "gradient",
      },
      value: {
        type: String,
        default:
          "linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%)",
      },
      textColor: {
        type: String,
        default: "#FFFFFF",
      },
      font: {
        type: String,
        enum: ["sans", "serif", "mono", "cursive", "handwriting"],
        default: "sans",
      },
    },
    privacy: {
      type: String,
      enum: ["everyone", "contacts", "custom", "excluded"],
      default: "contacts",
    },
    allowedViewers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    excludedViewers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    views: [StoryViewSchema],
    viewCount: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
  },
);

StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

StorySchema.index({ userId: 1, expiresAt: 1, createdAt: -1 });
StorySchema.index({ "views.userId": 1 });

StorySchema.methods.isActive = function () {
  return this.expiresAt && this.expiresAt.getTime() > Date.now();
};

StorySchema.statics.findActive = function (conditions = {}) {
  return this.find({
    ...conditions,
    expiresAt: { $gt: new Date() },
  });
};

const Story = mongoose.model("Story", StorySchema);

export default Story;
