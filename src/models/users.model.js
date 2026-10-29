import mongoose from "mongoose";

import {
  salt,
  accessToken,
  accessTokenExpiresIn,
  refreshTokenScret,
  refreshTokenExpiresIn,
} from "../constants/constant.js";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/apiError.js";

const UserSchema = mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
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

    blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    timezone: { type: String, trim: true },
    lastSeen: { type: Date },
    publicKey: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      select: false,
    },
    publicKeyUpdatedAt: { type: Date },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },

    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    twoFactorPendingSecret: { type: String, select: false },
    recoveryCodes: { type: [String], select: false, default: [] },

    loginAlerts: { type: Boolean, default: true },

    tokenVersion: { type: Number, default: 0, select: false },

    showOnlineStatus: { type: Boolean, default: true },
    readReceipts: { type: Boolean, default: true },
    typingIndicator: { type: Boolean, default: true },

    enterToSend: { type: Boolean, default: true },
    largeEmoji: { type: Boolean, default: true },
    autoScroll: { type: Boolean, default: true },

    appearanceTheme: { type: String, default: "light" },
    appearanceFontSize: {
      type: String,
      enum: ["sm", "md", "lg"],
      default: "md",
    },
    appearanceBubbleStyle: {
      type: String,
      enum: ["rounded", "soft", "sharp"],
      default: "rounded",
    },
    appearanceDensity: {
      type: String,
      enum: ["comfortable", "compact"],
      default: "comfortable",
    },
    appearanceTimestamps: { type: Boolean, default: true },
    appearanceTimeFormat: {
      type: String,
      enum: ["12h", "24h"],
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
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

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

UserSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      id: this._id,
      email: this.email,
      fullName: this.fullName,
    },
    refreshTokenScret,
    { expiresIn: refreshTokenExpiresIn },
  );
};

UserSchema.statics.generateToken = async function (id, sessionId) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }

  const user = await this.findById(id).select("+tokenVersion");

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const accessToken = user.generateAccessToken(
    sessionId,
    user.tokenVersion ?? 0,
  );
  const refreshToken = user.generateRefreshToken();

  return { accessToken, refreshToken };
};

const User = mongoose.model("User", UserSchema);

export default User;
