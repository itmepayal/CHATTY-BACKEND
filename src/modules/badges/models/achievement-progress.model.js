import mongoose from "mongoose";

const AchievementProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    badgeSlug: {
      type: String,
      required: true,
      index: true,
    },
    criteriaType: {
      type: String,
      required: true,
      index: true,
    },
    currentProgress: {
      type: Number,
      default: 0,
      min: 0,
    },
    targetProgress: {
      type: Number,
      required: true,
      min: 1,
    },
    isCompleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastTrackedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

AchievementProgressSchema.index({ userId: 1, badgeSlug: 1 }, { unique: true });
AchievementProgressSchema.index({ userId: 1, criteriaType: 1 });

const AchievementProgress =
  mongoose.models.AchievementProgress ||
  mongoose.model("AchievementProgress", AchievementProgressSchema);
export { AchievementProgress };
export default AchievementProgress;
