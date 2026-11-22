import mongoose from "mongoose";

export const BADGE_CATEGORIES = Object.freeze({
  ACTIVITY: "activity",
  MESSAGING: "messaging",
  SOCIAL: "social",
  COMMUNITY: "community",
  GROUP: "group",
  ENGAGEMENT: "engagement",
  CREATOR: "creator",
  PREMIUM: "premium",
  SPECIAL_EVENT: "special_event",
  OFFICIAL: "official",
  ADMIN_AWARDED: "admin_awarded",
});

export const BADGE_RARITIES = Object.freeze({
  COMMON: "common",
  UNCOMMON: "uncommon",
  RARE: "rare",
  EPIC: "epic",
  LEGENDARY: "legendary",
  MYTHIC: "mythic",
});

export const RARITY_CONFIG = Object.freeze({
  common: {
    label: "Common",
    color: "#94a3b8", // Slate 400
    border: "border-slate-500/30",
    bg: "bg-slate-500/10",
    glow: "shadow-[0_0_10px_rgba(148,163,184,0.2)]",
    gradient: "from-slate-400 to-slate-600",
  },
  uncommon: {
    label: "Uncommon",
    color: "#22c55e", // Emerald 500
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/10",
    glow: "shadow-[0_0_12px_rgba(34,197,94,0.25)]",
    gradient: "from-emerald-400 to-teal-600",
  },
  rare: {
    label: "Rare",
    color: "#0ea5e9", // Sky 500
    border: "border-sky-500/30",
    bg: "bg-sky-500/10",
    glow: "shadow-[0_0_14px_rgba(14,165,233,0.3)]",
    gradient: "from-sky-400 to-blue-600",
  },
  epic: {
    label: "Epic",
    color: "#a855f7", // Purple 500
    border: "border-purple-500/30",
    bg: "bg-purple-500/10",
    glow: "shadow-[0_0_16px_rgba(168,85,247,0.35)]",
    gradient: "from-purple-400 to-indigo-600",
  },
  legendary: {
    label: "Legendary",
    color: "#f59e0b", // Amber 500
    border: "border-amber-500/30",
    bg: "bg-amber-500/10",
    glow: "shadow-[0_0_20px_rgba(245,158,11,0.4)]",
    gradient: "from-amber-400 to-orange-600",
  },
  mythic: {
    label: "Mythic",
    color: "#ec4899", // Rose/Pink 500
    border: "border-pink-500/40",
    bg: "bg-pink-500/15",
    glow: "shadow-[0_0_25px_rgba(236,72,153,0.5)]",
    gradient: "from-pink-500 via-rose-500 to-purple-600",
  },
});

const BadgeSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      required: true,
      default: "Award",
    },
    category: {
      type: String,
      enum: Object.values(BADGE_CATEGORIES),
      default: BADGE_CATEGORIES.MESSAGING,
      index: true,
    },
    rarity: {
      type: String,
      enum: Object.values(BADGE_RARITIES),
      default: BADGE_RARITIES.COMMON,
      index: true,
    },
    criteria: {
      type: {
        type: String,
        required: true,
        index: true,
      },
      threshold: {
        type: Number,
        required: true,
        default: 1,
      },
    },
    rewards: {
      coins: {
        type: Number,
        default: 0,
      },
      title: {
        type: String,
        default: "",
      },
    },
    isSecret: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isTemporary: {
      type: Boolean,
      default: false,
    },
    durationDays: {
      type: Number,
      default: null,
    },
    color: {
      type: String,
      default: "",
    },
    order: {
      type: Number,
      default: 0,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

BadgeSchema.index({ category: 1, rarity: 1, isActive: 1 });
BadgeSchema.index({ "criteria.type": 1, isActive: 1 });

const Badge = mongoose.models.Badge || mongoose.model("Badge", BadgeSchema);
export { Badge };
export default Badge;
