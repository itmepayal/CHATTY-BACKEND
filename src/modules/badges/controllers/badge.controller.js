import { StatusCodes } from "http-status-codes";
import * as achievementService from "../services/achievement-engine.service.js";
import Badge from "../models/badge.model.js";
import BadgeAuditLog from "../models/badge-audit-log.model.js";
import User from "../../users/models/users.model.js";

export const getBadgesCatalog = async (req, res) => {
  try {
    const badges = await Badge.find({ isActive: true }).sort({ order: 1 }).lean();
    const categories = [...new Set(badges.map((b) => b.category))];
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        badges,
        categories,
      },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch badges catalog",
    });
  }
};

export const getBadgeDetails = async (req, res) => {
  try {
    const { badgeId } = req.params;
    const badge = await Badge.findOne({
      $or: [
        { _id: badgeId.match(/^[0-9a-fA-F]{24}$/) ? badgeId : null },
        { slug: badgeId },
      ],
      isActive: true,
    }).lean();

    if (!badge) {
      return res.status(StatusCodes.NOT_FOUND).json({ success: false, message: "Badge not found" });
    }

    return res.status(StatusCodes.OK).json({ success: true, data: badge });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch badge details",
    });
  }
};

export const getMyAchievements = async (req, res) => {
  try {
    const data = await achievementService.getUserAchievements(req.user._id);
    return res.status(StatusCodes.OK).json({ success: true, data });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch achievements",
    });
  }
};

export const getMyBadges = async (req, res) => {
  try {
    const [badges, userDoc] = await Promise.all([
      achievementService.getUserEarnedBadges(req.user._id, req.user._id),
      User.findById(req.user._id).populate("featuredBadge").lean(),
    ]);
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        badges,
        featuredBadge: userDoc?.featuredBadge || null,
        badgeVisibility: userDoc?.badgeVisibility || "public",
      },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch user badges",
    });
  }
};

export const getUserBadges = async (req, res) => {
  try {
    const { userId } = req.params;
    const [badges, userDoc] = await Promise.all([
      achievementService.getUserEarnedBadges(userId, req.user?._id),
      User.findById(userId).populate("featuredBadge").lean(),
    ]);
    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        badges,
        featuredBadge: userDoc?.featuredBadge || null,
      },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch user badges",
    });
  }
};

export const setFeaturedBadge = async (req, res) => {
  try {
    const rawBadgeId = req.params?.badgeId || req.body?.badgeId;
    const badgeId = rawBadgeId === "none" ? null : rawBadgeId;
    const featured = await achievementService.setFeaturedBadge(req.user._id, badgeId);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: badgeId ? "Featured badge updated." : "Featured badge cleared.",
      data: { featuredBadge: featured },
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to set featured badge",
    });
  }
};

export const updateBadgeVisibility = async (req, res) => {
  try {
    const { visibility } = req.body;
    if (!["public", "contacts", "private"].includes(visibility)) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "Invalid visibility option. Allowed: public, contacts, private.",
      });
    }

    await User.findByIdAndUpdate(req.user._id, { badgeVisibility: visibility });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: `Badge visibility updated to ${visibility}.`,
      data: { visibility },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to update visibility",
    });
  }
};

// Admin Controllers
export const adminAwardBadge = async (req, res) => {
  try {
    let { userId, badgeSlug, badgeId, reason } = req.body;
    if (!badgeSlug && badgeId) {
      const b = await Badge.findById(badgeId).lean();
      if (b) badgeSlug = b.slug;
    }

    if (!userId || !badgeSlug) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "userId and badgeSlug are required.",
      });
    }

    const awarded = await achievementService.adminAwardBadge(req.user._id, userId, badgeSlug, reason);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Badge awarded successfully.",
      data: awarded,
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to award badge",
    });
  }
};

export const adminRevokeBadge = async (req, res) => {
  try {
    let { userId, badgeSlug, badgeId, reason } = req.body;
    if (!badgeSlug && badgeId) {
      const b = await Badge.findById(badgeId).lean();
      if (b) badgeSlug = b.slug;
    }

    if (!userId || !badgeSlug) {
      return res.status(StatusCodes.BAD_REQUEST).json({
        success: false,
        message: "userId and badgeSlug are required.",
      });
    }

    await achievementService.adminRevokeBadge(req.user._id, userId, badgeSlug, reason);
    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Badge revoked successfully.",
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to revoke badge",
    });
  }
};

export const adminGetAuditLogs = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      BadgeAuditLog.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "fullName username avatar")
        .populate("adminId", "fullName username avatar")
        .populate("badgeId", "name icon rarity category")
        .lean(),
      BadgeAuditLog.countDocuments(),
    ]);

    return res.status(StatusCodes.OK).json({
      success: true,
      data: {
        logs,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: error?.message || "Failed to fetch audit logs",
    });
  }
};

export const adminCreateBadge = async (req, res) => {
  try {
    const badge = await achievementService.createBadge(req.user._id, req.body);
    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Badge created successfully.",
      data: badge,
    });
  } catch (error) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: error?.message || "Failed to create badge",
    });
  }
};
