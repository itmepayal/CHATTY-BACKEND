import mongoose from "mongoose";
import Badge from "../models/badge.model.js";
import UserBadge from "../models/user-badge.model.js";
import AchievementProgress from "../models/achievement-progress.model.js";
import BadgeAuditLog from "../models/badge-audit-log.model.js";
import User from "../../users/models/users.model.js";
import { DEFAULT_BADGES } from "../data/default-badges.data.js";
import { io } from "../../../infrastructure/socket/socket.js";
import { dispatchNotification } from "../../notifications/services/notification.service.js";
import { NOTIFICATION_TYPES } from "../../notifications/models/notification.model.js";
import Wallet from "../../gifts/models/wallet.model.js";

/**
 * Ensures all default badges exist in the database.
 * Run once on server startup or module initialization.
 */
export const ensureDefaultBadgesSeeded = async () => {
  try {
    for (const badgeDef of DEFAULT_BADGES) {
      await Badge.findOneAndUpdate(
        { slug: badgeDef.slug },
        { $setOnInsert: badgeDef },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }
  } catch (error) {
    console.error("[AchievementEngine] Seed error:", error?.message || error);
  }
};

/**
 * Evaluates and awards a badge to a user idempotently.
 */
export const awardBadge = async (userId, badge, reason = "Achievement Criteria Met", adminId = null) => {
  if (!userId || !badge) return null;

  try {
    const existing = await UserBadge.findOne({
      userId,
      badgeSlug: badge.slug,
    });

    if (existing) {
      if (existing.isRevoked) {
        existing.isRevoked = false;
        existing.revokedAt = null;
        existing.revokedReason = null;
        existing.revokedBy = null;
        existing.unlockedAt = new Date();
        await existing.save();
      } else {
        return existing; // Already earned
      }
    } else {
      await UserBadge.create({
        userId,
        badgeId: badge._id,
        badgeSlug: badge.slug,
        unlockedAt: new Date(),
        isFeatured: false,
        expiresAt: badge.isTemporary && badge.durationDays
          ? new Date(Date.now() + badge.durationDays * 86400000)
          : null,
      });
    }

    // Reward user with wallet coins if badge has a coin reward
    if (badge.rewards?.coins > 0) {
      await Wallet.findOneAndUpdate(
        { userId },
        { $inc: { balance: badge.rewards.coins, totalReceived: badge.rewards.coins } },
        { upsert: true },
      );
    }

    // Set as featured badge automatically if user doesn't have one yet
    const userDoc = await User.findById(userId).select("featuredBadge").lean();
    if (!userDoc?.featuredBadge) {
      await User.findByIdAndUpdate(userId, { featuredBadge: badge._id });
    }

    // Real-time socket event delivery to user's personal room
    if (io) {
      const payload = {
        badge: {
          _id: badge._id,
          slug: badge.slug,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          category: badge.category,
          rarity: badge.rarity,
          rewards: badge.rewards,
          color: badge.color,
        },
        rewardCoins: badge.rewards?.coins || 0,
        unlockedAt: new Date(),
      };
      io.to(userId.toString()).emit("badge:unlocked", payload);
      io.to(userId.toString()).emit("achievement:completed", payload);
    }

    // Persistent notification dispatch
    try {
      await dispatchNotification({
        recipientId: userId,
        senderId: adminId || null,
        category: "achievement",
        type: NOTIFICATION_TYPES.ACHIEVEMENT_UNLOCKED,
        title: "Achievement Unlocked! 🏆",
        body: `You unlocked the ${badge.rarity.toUpperCase()} badge: "${badge.name}"!`,
        data: {
          badgeId: String(badge._id),
          badgeSlug: badge.slug,
          rarity: badge.rarity,
          rewardCoins: badge.rewards?.coins || 0,
        },
      });
    } catch (_notifErr) {
      // Non-fatal
    }

    // Audit log if admin awarded
    if (adminId) {
      await BadgeAuditLog.create({
        badgeId: badge._id,
        badgeSlug: badge.slug,
        userId,
        adminId,
        action: "manual_award",
        reason,
      });
    }

    return true;
  } catch (error) {
    if (error?.code === 11000) {
      // Duplicate key race condition safely handled
      return null;
    }
    console.error("[AchievementEngine] awardBadge error:", error?.message || error);
    return null;
  }
};

/**
 * Central event-driven progress tracker.
 * Efficient, non-blocking, and concurrency-safe.
 */
export const trackActivity = async (userId, activityType, count = 1, metadata = {}) => {
  if (!userId || !activityType) return;

  try {
    // Find all active badges requiring this activity
    const eligibleBadges = await Badge.find({
      "criteria.type": activityType,
      isActive: true,
    }).lean();

    if (!eligibleBadges || eligibleBadges.length === 0) return;

    for (const badge of eligibleBadges) {
      // Fetch or update progress atomically
      const progress = await AchievementProgress.findOneAndUpdate(
        { userId, badgeSlug: badge.slug },
        {
          $setOnInsert: {
            criteriaType: activityType,
            targetProgress: badge.criteria.threshold,
          },
          $inc: { currentProgress: count },
          $set: { lastTrackedAt: new Date() },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );

      // Check if requirement reached
      if (progress.currentProgress >= progress.targetProgress && !progress.isCompleted) {
        progress.isCompleted = true;
        progress.completedAt = new Date();
        await progress.save();

        await awardBadge(userId, badge);
      } else {
        // Emit progress update to user socket
        if (io) {
          const progressPayload = {
            badgeSlug: badge.slug,
            currentProgress: progress.currentProgress,
            targetProgress: progress.targetProgress,
            percentage: Math.min(100, Math.round((progress.currentProgress / progress.targetProgress) * 100)),
          };
          io.to(userId.toString()).emit("achievement:progress", progressPayload);
          io.to(userId.toString()).emit("badge:progress", progressPayload);
        }
      }
    }
  } catch (error) {
    // Fire-and-forget: activity tracking should not break core messages or operations
    console.error(`[AchievementEngine] trackActivity failed for ${activityType}:`, error?.message || error);
  }
};

/**
 * Gets a user's full achievement dashboard with progress calculation.
 */
export const getUserAchievements = async (userId) => {
  const [allBadges, userBadges, userProgress] = await Promise.all([
    Badge.find({ isActive: true }).sort({ order: 1 }).lean(),
    UserBadge.find({ userId, isRevoked: false }).lean(),
    AchievementProgress.find({ userId }).lean(),
  ]);

  const earnedMap = new Map(userBadges.map((ub) => [ub.badgeSlug, ub]));
  const progressMap = new Map(userProgress.map((up) => [up.badgeSlug, up]));

  const achievements = allBadges.map((badge) => {
    const earned = earnedMap.get(badge.slug);
    const prog = progressMap.get(badge.slug);
    const target = badge.criteria?.threshold || 1;
    const current = earned ? target : Math.min(target, prog?.currentProgress || 0);
    const percentage = earned ? 100 : Math.min(100, Math.round((current / target) * 100));

    return {
      _id: badge._id,
      slug: badge.slug,
      name: badge.name,
      description: badge.description,
      icon: badge.icon,
      category: badge.category,
      rarity: badge.rarity,
      rewards: badge.rewards,
      color: badge.color,
      isSecret: badge.isSecret,
      criteria: badge.criteria,
      isUnlocked: Boolean(earned),
      unlockedAt: earned?.unlockedAt || null,
      isFeatured: earned?.isFeatured || false,
      currentProgress: current,
      targetProgress: target,
      percentage,
    };
  });

  const totalBadges = allBadges.length;
  const unlockedCount = userBadges.length;
  const totalCompletionPercent = totalBadges > 0 ? Math.round((unlockedCount / totalBadges) * 100) : 0;

  const achieved = achievements.filter((a) => a.isUnlocked);
  const inProgress = achievements
    .filter((a) => !a.isUnlocked)
    .sort((a, b) => b.percentage - a.percentage);

  const streakProg = userProgress.find((p) => p.criteriaType === "streak_days" || p.badgeSlug === "streak_master");
  const streak = Math.max(1, streakProg?.currentProgress || 1);

  return {
    achievements,
    achieved,
    inProgress,
    stats: {
      totalBadges,
      unlockedCount,
      inProgressCount: inProgress.length,
      completionPercentage: totalCompletionPercent,
      totalCompletionPercent,
      streak,
      activityStreak: streak,
    },
  };
};

/**
 * Returns a user's earned badges, filtered by privacy settings if viewerId != userId.
 */
export const getUserEarnedBadges = async (userId, viewerId = null) => {
  const isOwner = String(userId) === String(viewerId);

  // Check user visibility setting if not owner
  if (!isOwner) {
    const user = await User.findById(userId).select("badgeVisibility blockedUsers").lean();
    if (!user) return [];
    if (user.badgeVisibility === "private") return [];
    if (user.blockedUsers?.map(String).includes(String(viewerId))) return [];
  }

  const userBadges = await UserBadge.find({ userId, isRevoked: false })
    .populate("badgeId")
    .sort({ isFeatured: -1, unlockedAt: -1 })
    .lean();

  return userBadges
    .filter((ub) => ub.badgeId)
    .map((ub) => ({
      _id: ub._id,
      badgeId: ub.badgeId._id,
      slug: ub.badgeSlug,
      name: ub.badgeId.name,
      description: ub.badgeId.description,
      icon: ub.badgeId.icon,
      category: ub.badgeId.category,
      rarity: ub.badgeId.rarity,
      color: ub.badgeId.color,
      rewards: ub.badgeId.rewards,
      unlockedAt: ub.unlockedAt,
      isFeatured: ub.isFeatured,
      displayOrder: ub.displayOrder,
      badge: ub.badgeId,
    }));
};

/**
 * Updates a user's featured badge.
 */
export const setFeaturedBadge = async (userId, badgeId) => {
  if (!badgeId || badgeId === "none") {
    // Unset featured badge
    await Promise.all([
      UserBadge.updateMany({ userId }, { $set: { isFeatured: false } }),
      User.findByIdAndUpdate(userId, { featuredBadge: null }),
    ]);
    return null;
  }

  const isObjectId = mongoose.Types.ObjectId.isValid(badgeId);
  const userBadge = await UserBadge.findOne({
    userId,
    ...(isObjectId
      ? { $or: [{ badgeId }, { badgeSlug: badgeId }] }
      : { badgeSlug: badgeId }),
    isRevoked: false,
  }).populate("badgeId");

  if (!userBadge) {
    throw new Error("You have not unlocked this badge yet.");
  }

  await UserBadge.updateMany({ userId }, { $set: { isFeatured: false } });
  userBadge.isFeatured = true;
  await userBadge.save();

  await User.findByIdAndUpdate(userId, { featuredBadge: userBadge.badgeId._id });

  return userBadge.badgeId;
};

/**
 * Admin manual award with audit logging.
 */
export const adminAwardBadge = async (adminId, userId, badgeSlug, reason = "") => {
  const badge = await Badge.findOne({ slug: badgeSlug, isActive: true });
  if (!badge) throw new Error("Badge not found");

  const awarded = await awardBadge(userId, badge, reason, adminId);
  return awarded;
};

/**
 * Admin manual revoke with audit logging.
 */
export const adminRevokeBadge = async (adminId, userId, badgeSlug, reason = "") => {
  const userBadge = await UserBadge.findOne({ userId, badgeSlug, isRevoked: false });
  if (!userBadge) throw new Error("Badge not held by user");

  userBadge.isRevoked = true;
  userBadge.revokedAt = new Date();
  userBadge.revokedReason = reason;
  userBadge.revokedBy = adminId;
  await userBadge.save();

  // If this was featured, clear it
  const userDoc = await User.findById(userId).select("featuredBadge").lean();
  if (String(userDoc?.featuredBadge) === String(userBadge.badgeId)) {
    await User.findByIdAndUpdate(userId, { featuredBadge: null });
  }

  await BadgeAuditLog.create({
    badgeId: userBadge.badgeId,
    badgeSlug,
    userId,
    adminId,
    action: "manual_revoke",
    reason,
  });

  if (io) {
    io.to(userId.toString()).emit("badge:revoked", {
      badgeSlug,
      reason,
    });
  }

  return true;
};

export const createBadge = async (adminId, badgeData) => {
  const badge = await Badge.create(badgeData);
  await BadgeAuditLog.create({
    badgeId: badge._id,
    badgeSlug: badge.slug,
    adminId,
    userId: adminId,
    action: "create_badge",
    reason: "New badge definition created by admin",
    metadata: badgeData,
  });
  return badge;
};
