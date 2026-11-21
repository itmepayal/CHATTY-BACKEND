import mongoose from "mongoose";

import {
  salt,
  accessToken,
  accessTokenExpiresIn,
  refreshTokenSecret,
  refreshTokenExpiresIn,
} from "../../auth/constants/auth.constants.js";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import { VIS, ONLINE_VIS, STATUS_VIS } from "../../privacy/constants/privacy.constants.js";

export { VIS, ONLINE_VIS, STATUS_VIS };

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
    },

    password: {
      type: String,
      required: true,
      minlength: 6,
      select: false,
    },

    avatar: {
      public_id: {
        type: String,
      },
      url: {
        type: String,
      },
    },

    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      match: [/^[a-z0-9_.]{3,20}$/, "Invalid username"],
    },

    phone: {
      type: String,
      trim: true,
      match: [/^[+\d][\d\s-]{7,15}$/, "Invalid phone"],
    },

    gender: {
      type: String,
      enum: ["Female", "Male", "Other", "Prefer not to say", ""],
      default: "",
    },

    dob: {
      type: Date,
    },

    location: {
      type: String,
      trim: true,
      maxlength: 60,
    },

    website: {
      type: String,
      trim: true,
      match: [/^https?:\/\/.+\..+/, "Invalid URL"],
    },

    bio: {
      type: String,
      trim: true,
      maxlength: 160,
    },

    customStatus: {
      type: String,
      trim: true,
      maxlength: 120,
      default: "",
    },

    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    favorites: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    pinnedChats: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    mutedChats: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    timezone: {
      type: String,
      trim: true,
    },

    lastSeen: {
      type: Date,
      default: Date.now,
    },

    publicKey: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      select: false,
    },

    encryptedPrivateKey: {
      type: String,
      default: null,
      select: false,
    },

    publicKeyUpdatedAt: {
      type: Date,
      default: null,
    },

    e2eeBackupVersion: {
      type: Number,
      default: null,
      select: false,
    },

    e2eeBackupUpdatedAt: {
      type: Date,
      default: null,
      select: false,
    },

    passwordResetToken: {
      type: String,
      select: false,
    },

    passwordResetExpires: {
      type: Date,
      select: false,
    },

    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },

    twoFactorSecret: {
      type: String,
      select: false,
    },

    twoFactorPendingSecret: {
      type: String,
      select: false,
    },

    recoveryCodes: {
      type: [String],
      select: false,
      default: [],
    },

    loginAlerts: {
      type: Boolean,
      default: true,
    },

    tokenVersion: {
      type: Number,
      default: 0,
      select: false,
    },

    role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
      index: true,
    },

    status: {
      type: String,
      enum: ["active", "suspended", "deactivated"],
      default: "active",
      alias: "accountStatus",
      index: true,
    },

    showOnlineStatus: {
      type: Boolean,
      default: true,
    },

    onlineStatusVisibility: {
      type: String,
      enum: ONLINE_VIS,
      default: "everyone",
    },

    readReceipts: {
      type: Boolean,
      default: true,
    },

    typingIndicator: {
      type: Boolean,
      default: true,
    },

    lastSeenVisibility: {
      type: String,
      enum: VIS,
      default: "everyone",
    },

    lastSeenExceptions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    profilePhotoVisibility: {
      type: String,
      enum: VIS,
      default: "everyone",
    },

    profilePhotoExceptions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    aboutVisibility: {
      type: String,
      enum: VIS,
      default: "everyone",
    },

    aboutExceptions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    statusVisibility: {
      type: String,
      enum: STATUS_VIS,
      default: "contacts",
    },

    statusExceptions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    statusIncluded: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    groupAddPermission: {
      type: String,
      enum: VIS,
      default: "everyone",
    },

    groupAddExceptions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],

    silenceUnknownCallers: {
      type: Boolean,
      default: false,
    },

    appLockEnabled: {
      type: Boolean,
      default: false,
    },

    appLockTimeout: {
      type: String,
      enum: ["immediately", "1m", "5m", "15m", "1h"],
      default: "immediately",
    },

    appLockPinHash: {
      type: String,
      default: null,
      select: false,
    },

    lockFailedAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    lockoutUntil: {
      type: Date,
      default: null,
      select: false,
    },

    lockEpoch: {
      type: Number,
      default: 0,
      select: false,
    },

    lockedChats: [
      {
        type: String,
        default: [],
      },
    ],

    enterToSend: {
      type: Boolean,
      default: true,
    },

    largeEmoji: {
      type: Boolean,
      default: true,
    },

    autoScroll: {
      type: Boolean,
      default: true,
    },

    notificationSettings: {
      soundEnabled: {
        type: Boolean,
        default: true,
      },
      soundVolume: {
        type: Number,
        min: 0,
        max: 100,
        default: 60,
      },
      desktopNotifications: {
        type: Boolean,
        default: false,
      },
      showPreview: {
        type: Boolean,
        default: true,
      },
    },

    notificationPreferences: {
      messagesPersonal: { type: Boolean, default: true },
      messagesGroup: { type: Boolean, default: true },
      messageReplies: { type: Boolean, default: true },
      messageMentions: { type: Boolean, default: true },
      messageReactions: { type: Boolean, default: true },
      mediaNotifications: { type: Boolean, default: true },
      callsVoice: { type: Boolean, default: true },
      callsVideo: { type: Boolean, default: true },
      callsMissed: { type: Boolean, default: true },
      callsGroup: { type: Boolean, default: true },
      contactRequests: { type: Boolean, default: true },
      contactAcceptance: { type: Boolean, default: true },
      groupInvitations: { type: Boolean, default: true },
      groupMembershipEvents: { type: Boolean, default: true },
      securityNewDevice: { type: Boolean, default: true },
      securityDeviceLinking: { type: Boolean, default: true },
      securityCredentialChanges: { type: Boolean, default: true },
      securityE2EEAlerts: { type: Boolean, default: true },
      systemAnnouncements: { type: Boolean, default: true },
      systemMaintenance: { type: Boolean, default: true },
      systemAlerts: { type: Boolean, default: true },
      dndEnabled: { type: Boolean, default: false },
      dndUntil: { type: Date, default: null },
      mutedConversations: [{ type: String, default: [] }],
      mutedGroups: [{ type: String, default: [] }],
      pushSubscriptions: [
        {
          endpoint: { type: String, required: true },
          keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true },
          },
          userAgent: { type: String, default: "" },
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },

    theme: {
      type: String,
      default: "light",
    },

    fontSize: {
      type: String,
      enum: ["sm", "md", "lg"],
      default: "md",
    },

    bubbleStyle: {
      type: String,
      enum: ["rounded", "soft", "sharp"],
      default: "rounded",
    },

    density: {
      type: String,
      enum: ["comfortable", "compact"],
      default: "comfortable",
    },

    showTimestamps: {
      type: Boolean,
      default: true,
    },

    timeFormat: {
      type: String,
      enum: ["12h", "24h"],
      default: "12h",
    },

    appearanceTheme: {
      type: String,
      default: "light",
    },

    appearanceFontSize: {
      type: String,
      enum: ["sm", "md", "lg", "small", "medium", "large"],
      default: "md",
    },

    appearanceBubbleStyle: {
      type: String,
      enum: ["rounded", "soft", "sharp", "round"],
      default: "rounded",
    },

    appearanceDensity: {
      type: String,
      enum: ["comfortable", "compact", "cozy"],
      default: "comfortable",
    },

    appearanceTimestamps: {
      type: Boolean,
      default: true,
    },

    appearanceTimeFormat: {
      type: String,
      enum: ["12h", "24h", "12-hour", "24-hour"],
      default: "12h",
    },
  },
  {
    timestamps: true,

    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret.password;
        delete ret.__v;
        delete ret.twoFactorSecret;
        delete ret.twoFactorPendingSecret;
        delete ret.recoveryCodes;
        delete ret.tokenVersion;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.publicKey;
        delete ret.encryptedPrivateKey;
        delete ret.e2eeBackupVersion;
        delete ret.e2eeBackupUpdatedAt;
        delete ret.appLockPinHash;
        delete ret.lockFailedAttempts;
        delete ret.lockoutUntil;
        delete ret.lockEpoch;
        return ret;
      },
    },

    toObject: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret.password;
        delete ret.__v;
        delete ret.twoFactorSecret;
        delete ret.twoFactorPendingSecret;
        delete ret.recoveryCodes;
        delete ret.tokenVersion;
        delete ret.passwordResetToken;
        delete ret.passwordResetExpires;
        delete ret.publicKey;
        delete ret.encryptedPrivateKey;
        delete ret.e2eeBackupVersion;
        delete ret.e2eeBackupUpdatedAt;
        delete ret.appLockPinHash;
        delete ret.lockFailedAttempts;
        delete ret.lockoutUntil;
        delete ret.lockEpoch;
        return ret;
      },
    },
  },
);

UserSchema.index({ blockedUsers: 1 });
UserSchema.index({ fullName: 1 });

UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

  try {
    const genSalt = await bcrypt.genSalt(salt);
    this.password = await bcrypt.hash(this.password, genSalt);
    next();
  } catch (error) {
    next(error);
  }
});

UserSchema.methods.isPassword = async function (password) {
  return await bcrypt.compare(password, this.password);
};

UserSchema.methods.generateAccessToken = function (sessionId, tokenVer) {
  return jwt.sign(
    {
      id: this._id,
      email: this.email,
      fullName: this.fullName,
      ...(sessionId ? { sessionId: String(sessionId) } : {}),
      ...(tokenVer !== undefined ? { tokenVersion: tokenVer } : {}),
    },
    accessToken,
    { expiresIn: accessTokenExpiresIn },
  );
};

UserSchema.methods.generateRefreshToken = function (sessionId, tokenVer) {
  return jwt.sign(
    {
      id: this._id,
      email: this.email,
      fullName: this.fullName,
      ...(sessionId ? { sessionId: String(sessionId) } : {}),
      ...(tokenVer !== undefined ? { tokenVersion: tokenVer } : {}),
    },
    refreshTokenSecret,
    { expiresIn: refreshTokenExpiresIn },
  );
};

UserSchema.statics.generateToken = async function (id, sessionId) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }

  const user = await this.findById(id).select("+tokenVersion");

  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "User not found.");
  }

  if (user.status === "suspended") {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Your account has been suspended. Please contact support.",
    );
  }

  const tokenVer = user.tokenVersion ?? 0;
  const accessToken = user.generateAccessToken(sessionId, tokenVer);
  const refreshToken = user.generateRefreshToken(sessionId, tokenVer);

  return {
    accessToken,
    refreshToken,
  };
};

const User = mongoose.model("User", UserSchema);

export default User;
