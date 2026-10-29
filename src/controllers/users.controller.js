import mongoose from "mongoose";
import User from "../models/users.model.js";
import GroupKey from "../models/groupKey.model.js";
import {
  deleteFileToCloudinary,
  uploadFileToCloudinary,
} from "../config/cloudinary.config.js";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import { StatusCodes } from "http-status-codes";
import formatUser from "../utils/formateUser.js";
import { io, refreshPrivacy } from "../lib/socket.js";

const EDITABLE_FIELDS = [
  "fullName",
  "username",
  "phone",
  "gender",
  "dob",
  "location",
  "website",
  "bio",
  "timezone",
];

const GENDERS = ["Female", "Male", "Other", "Prefer not to say", ""];

const isValidTimeZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const RULES = {
  fullName: {
    test: (v) => v.length >= 2 && v.length <= 50,
    msg: "Full name must be 2-50 characters.",
  },
  username: {
    test: (v) => /^[a-z0-9_.]{3,20}$/.test(v),
    msg: "Username must be 3-20 characters (letters, numbers, _ or .).",
  },
  phone: {
    test: (v) => /^[+\d][\d\s-]{7,15}$/.test(v),
    msg: "Invalid phone number.",
  },
  gender: {
    test: (v) => GENDERS.includes(v),
    msg: "Invalid gender value.",
  },
  location: {
    test: (v) => v.length <= 60,
    msg: "Location can be at most 60 characters.",
  },
  website: {
    test: (v) => /^https?:\/\/.+\..+/.test(v),
    msg: "Website must start with http:// or https://",
  },
  bio: {
    test: (v) => v.length <= 160,
    msg: "Bio can be at most 160 characters.",
  },
  timezone: {
    test: isValidTimeZone,
    msg: "Invalid timezone (example: Asia/Kolkata).",
  },
};

const makeRelationHandler = (field, action, message) =>
  asyncHandler(async (req, res) => {
    const myId = req.user?._id;
    const targetId = req.params.id;

    if (!myId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
    }
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
    }
    if (String(targetId) === String(myId)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You can't do this to yourself.",
      );
    }
    if (!(await User.exists({ _id: targetId }))) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    if (field === "favorites" && action === "add") {
      const me = await User.findById(myId).select("blockedUsers");
      const isBlocked = me?.blockedUsers?.some(
        (b) => String(b) === String(targetId),
      );
      if (isBlocked) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Unblock this user before adding to favorites.",
        );
      }
    }

    const update =
      action === "add"
        ? { $addToSet: { [field]: targetId } }
        : { $pull: { [field]: targetId } };

    if (field === "blockedUsers" && action === "add") {
      update.$pull = { favorites: targetId };
    }

    const updatedUser = await User.findByIdAndUpdate(myId, update, {
      new: true,
    });

    if (!updatedUser) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    io.to(String(myId)).emit("relationsUpdated", {
      blockedUsers: (updatedUser.blockedUsers || []).map(String),
      favorites: (updatedUser.favorites || []).map(String),
    });

    return new ApiResponse(
      StatusCodes.OK,
      { user: formatUser(updatedUser) },
      message,
    ).send(res);
  });

const usersController = {
  updateProfile: asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
    }

    const $set = {};
    const $unset = {};

    for (const field of EDITABLE_FIELDS) {
      const raw = req.body[field];
      if (raw === undefined || raw === null) continue;

      let value = String(raw).trim();
      if (field === "username") value = value.toLowerCase();

      if (field === "fullName" && !value) {
        throw new ApiError(StatusCodes.BAD_REQUEST, "Full name is required.");
      }

      if (!value) {
        if (field === "gender") $set.gender = "";
        else $unset[field] = 1;
        continue;
      }

      if (field === "dob") {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
          throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid date of birth.");
        }
        if (date > new Date()) {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            "Date of birth cannot be in the future.",
          );
        }
        $set.dob = date;
        continue;
      }

      const rule = RULES[field];
      if (rule && !rule.test(value)) {
        throw new ApiError(StatusCodes.BAD_REQUEST, rule.msg);
      }

      $set[field] = value;
    }

    if (!Object.keys($set).length && !Object.keys($unset).length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No changes to update.");
    }

    if ($set.username) {
      const taken = await User.exists({
        username: $set.username,
        _id: { $ne: userId },
      });
      if (taken) {
        throw new ApiError(StatusCodes.CONFLICT, "Username is already taken.");
      }
    }

    const update = {};
    if (Object.keys($set).length) update.$set = $set;
    if (Object.keys($unset).length) update.$unset = $unset;

    let updatedUser;
    try {
      updatedUser = await User.findByIdAndUpdate(userId, update, {
        new: true,
        runValidators: true,
      });
    } catch (error) {
      if (error?.code === 11000) {
        throw new ApiError(StatusCodes.CONFLICT, "Username is already taken.");
      }
      throw error;
    }

    if (!updatedUser) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    return new ApiResponse(
      StatusCodes.OK,
      { user: formatUser(updatedUser) },
      "Profile updated successfully.",
    ).send(res);
  }),

  updateAvatar: asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
    }

    if (!req.file) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No file uploaded.");
    }

    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    const avatar = await uploadFileToCloudinary(req.file?.path);

    if (!avatar) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Failed to upload avatar file.",
      );
    }

    const oldPublicId = user.avatar?.public_id;

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        avatar: {
          public_id: avatar.public_id,
          url: avatar.secure_url,
        },
      },
      { new: true, runValidators: true },
    );

    if (oldPublicId) {
      await deleteFileToCloudinary(oldPublicId);
    }

    return new ApiResponse(
      StatusCodes.OK,
      { user: formatUser(updatedUser) },
      "Avatar updated successfully.",
    ).send(res);
  }),

  deleteAvatar: asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
    }

    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    if (user.avatar?.public_id) {
      await deleteFileToCloudinary(user.avatar.public_id);
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { avatar: { public_id: "", url: "" } },
      { new: true, runValidators: true },
    );

    return new ApiResponse(
      StatusCodes.OK,
      { user: formatUser(updatedUser) },
      "Avatar removed successfully.",
    ).send(res);
  }),

  getCurrentUser: asyncHandler(async (req, res) => {
    const userId = req.user?._id;

    if (!userId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
    }

    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    return new ApiResponse(
      StatusCodes.OK,
      { user: formatUser(user) },
      "Current user fetched successfully.",
    ).send(res);
  }),

  blockUser: makeRelationHandler("blockedUsers", "add", "User blocked."),
  unblockUser: makeRelationHandler("blockedUsers", "remove", "User unblocked."),
  addFavorite: makeRelationHandler("favorites", "add", "Added to favorites."),
  removeFavorite: makeRelationHandler(
    "favorites",
    "remove",
    "Removed from favorites.",
  ),

  getPrivacySettings: asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
    }

    const user = await User.findById(userId).select(
      "showOnlineStatus readReceipts typingIndicator",
    );
    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    return new ApiResponse(
      StatusCodes.OK,
      {
        showOnlineStatus: user.showOnlineStatus !== false,
        readReceipts: user.readReceipts !== false,
        typingIndicator: user.typingIndicator !== false,
      },
      "Privacy settings fetched successfully.",
    ).send(res);
  }),

  updatePrivacySettings: asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");
    }

    const ALLOWED = ["showOnlineStatus", "readReceipts", "typingIndicator"];

    const unknownKeys = Object.keys(req.body).filter(
      (k) => !ALLOWED.includes(k),
    );
    if (unknownKeys.length) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Unknown field(s): ${unknownKeys.join(", ")}`,
      );
    }

    const $set = {};
    for (const key of ALLOWED) {
      if (key in req.body) {
        if (typeof req.body[key] !== "boolean") {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `"${key}" must be a boolean.`,
          );
        }
        $set[key] = req.body[key];
      }
    }

    if (!Object.keys($set).length) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "No privacy fields provided.",
      );
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set },
      { new: true, runValidators: true },
    ).select("showOnlineStatus readReceipts typingIndicator");

    if (!updated) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
    }

    const privacy = {
      showOnlineStatus: updated.showOnlineStatus !== false,
      readReceipts: updated.readReceipts !== false,
      typingIndicator: updated.typingIndicator !== false,
    };

    await refreshPrivacy(userId);

    return new ApiResponse(
      StatusCodes.OK,
      privacy,
      "Privacy settings updated successfully.",
    ).send(res);
  }),

  getChatPrefs: asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId)
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");

    const user = await User.findById(userId).select(
      "enterToSend largeEmoji autoScroll",
    );
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    return new ApiResponse(
      StatusCodes.OK,
      {
        enterToSend: user.enterToSend !== false,
        largeEmoji: user.largeEmoji !== false,
        autoScroll: user.autoScroll !== false,
      },
      "Chat preferences fetched.",
    ).send(res);
  }),

  updateChatPrefs: asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId)
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");

    const ALLOWED = ["enterToSend", "largeEmoji", "autoScroll"];

    const unknownKeys = Object.keys(req.body).filter(
      (k) => !ALLOWED.includes(k),
    );
    if (unknownKeys.length)
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Unknown field(s): ${unknownKeys.join(", ")}`,
      );

    const $set = {};
    for (const key of ALLOWED) {
      if (key in req.body) {
        if (typeof req.body[key] !== "boolean")
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `"${key}" must be a boolean.`,
          );
        $set[key] = req.body[key];
      }
    }

    if (!Object.keys($set).length)
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "No chat-pref fields provided.",
      );

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set },
      { new: true, runValidators: true },
    ).select("enterToSend largeEmoji autoScroll");

    if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    return new ApiResponse(
      StatusCodes.OK,
      {
        enterToSend: updated.enterToSend !== false,
        largeEmoji: updated.largeEmoji !== false,
        autoScroll: updated.autoScroll !== false,
      },
      "Chat preferences updated.",
    ).send(res);
  }),

  getAppearance: asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId)
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");

    const user = await User.findById(userId).select(
      "appearanceTheme appearanceFontSize appearanceBubbleStyle appearanceDensity appearanceTimestamps appearanceTimeFormat",
    );
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    return new ApiResponse(
      StatusCodes.OK,
      {
        theme: user.appearanceTheme ?? "light",
        fontSize: user.appearanceFontSize ?? "md",
        bubbleStyle: user.appearanceBubbleStyle ?? "rounded",
        density: user.appearanceDensity ?? "comfortable",
        showTimestamps: user.appearanceTimestamps !== false,
        timeFormat: user.appearanceTimeFormat ?? "12h",
      },
      "Appearance preferences fetched.",
    ).send(res);
  }),

  updateAppearance: asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId)
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");

    const VALID_THEMES = [
      "light",
      "dark",
      "cupcake",
      "bumblebee",
      "emerald",
      "corporate",
      "synthwave",
      "retro",
      "cyberpunk",
      "valentine",
      "halloween",
      "garden",
      "forest",
      "aqua",
      "lofi",
      "pastel",
      "fantasy",
      "wireframe",
      "black",
      "luxury",
      "dracula",
      "cmyk",
      "autumn",
      "business",
      "acid",
      "lemonade",
      "night",
      "coffee",
      "winter",
      "dim",
      "nord",
      "sunset",
      "caramellatte",
      "abyss",
      "silk",
    ];
    const ENUMS = {
      theme: VALID_THEMES,
      fontSize: ["sm", "md", "lg"],
      bubbleStyle: ["rounded", "soft", "sharp"],
      density: ["comfortable", "compact"],
      timeFormat: ["12h", "24h"],
    };
    const BOOL_FIELDS = ["showTimestamps"];
    const ALL_ALLOWED = [...Object.keys(ENUMS), ...BOOL_FIELDS];

    const unknown = Object.keys(req.body).filter(
      (k) => !ALL_ALLOWED.includes(k),
    );
    if (unknown.length)
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Unknown field(s): ${unknown.join(", ")}`,
      );

    const $set = {};

    for (const [key, values] of Object.entries(ENUMS)) {
      if (key in req.body) {
        if (!values.includes(req.body[key]))
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `Invalid value for "${key}": ${req.body[key]}`,
          );
        const dbKey =
          key === "theme"
            ? "appearanceTheme"
            : key === "fontSize"
              ? "appearanceFontSize"
              : key === "bubbleStyle"
                ? "appearanceBubbleStyle"
                : key === "density"
                  ? "appearanceDensity"
                  : `appearance${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        $set[dbKey] = req.body[key];
      }
    }

    for (const key of BOOL_FIELDS) {
      if (key in req.body) {
        if (typeof req.body[key] !== "boolean")
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            `"${key}" must be a boolean.`,
          );
        $set.appearanceTimestamps = req.body[key];
      }
    }

    if (!Object.keys($set).length)
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "No appearance fields provided.",
      );

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set },
      { new: true, runValidators: false },
    ).select(
      "appearanceTheme appearanceFontSize appearanceBubbleStyle appearanceDensity appearanceTimestamps appearanceTimeFormat",
    );

    if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    return new ApiResponse(
      StatusCodes.OK,
      {
        theme: updated.appearanceTheme ?? "light",
        fontSize: updated.appearanceFontSize ?? "md",
        bubbleStyle: updated.appearanceBubbleStyle ?? "rounded",
        density: updated.appearanceDensity ?? "comfortable",
        showTimestamps: updated.appearanceTimestamps !== false,
        timeFormat: updated.appearanceTimeFormat ?? "12h",
      },
      "Appearance preferences updated.",
    ).send(res);
  }),

  /* ---------------- E2EE PUBLIC KEY ---------------- */
  // Body: { publicKey: { kty, crv, x, y } }
  // Key replace karne ke liye: { publicKey, replace: true, password }
  setMyPublicKey: asyncHandler(async (req, res) => {
    const userId = req.user?._id;
    if (!userId)
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");

    const pk = req.body?.publicKey;

    const valid =
      pk &&
      pk.kty === "EC" &&
      pk.crv === "P-256" &&
      typeof pk.x === "string" &&
      typeof pk.y === "string" &&
      pk.x.length > 0 &&
      pk.y.length > 0;

    if (!valid)
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid public key.");

    const publicKey = { kty: "EC", crv: "P-256", x: pk.x, y: pk.y };

    const existing = await User.findById(userId).select("+publicKey +password");
    if (!existing) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    const same =
      existing.publicKey &&
      existing.publicKey.x === publicKey.x &&
      existing.publicKey.y === publicKey.y;

    // same key dobara bheji to no-op
    if (same) {
      return new ApiResponse(
        StatusCodes.OK,
        {
          publicKey: existing.publicKey,
          publicKeyUpdatedAt: existing.publicKeyUpdatedAt || null,
        },
        "Public key saved.",
      ).send(res);
    }

    const isReplacing = Boolean(existing.publicKey);

    if (isReplacing) {
      // key replace karna sensitive hai: explicit flag + password dono maango
      if (req.body.replace !== true) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          "A key already exists. Replacing it makes old encrypted messages unreadable on new devices.",
        );
      }
      if (!(await existing.isPassword(String(req.body.password || "")))) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Password is incorrect.");
      }
    }

    const updated = await User.findByIdAndUpdate(
      userId,
      { $set: { publicKey, publicKeyUpdatedAt: new Date() } },
      { new: true },
    ).select("+publicKey");

    if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    // purani wrapped group keys nayi private key se unwrap nahi hongi
    if (isReplacing) {
      await GroupKey.deleteMany({ userId });
    }

    return new ApiResponse(
      StatusCodes.OK,
      {
        publicKey: updated.publicKey,
        publicKeyUpdatedAt: updated.publicKeyUpdatedAt,
      },
      "Public key saved.",
    ).send(res);
  }),

  getUserPublicKey: asyncHandler(async (req, res) => {
    const myId = req.user?._id;
    if (!myId)
      throw new ApiError(StatusCodes.UNAUTHORIZED, "User not authenticated.");

    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id))
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");

    const user = await User.findById(id).select(
      "+publicKey publicKeyUpdatedAt",
    );
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    if (!user.publicKey)
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        "This user has no encryption key yet.",
      );

    return new ApiResponse(
      StatusCodes.OK,
      {
        publicKey: user.publicKey,
        publicKeyUpdatedAt: user.publicKeyUpdatedAt || null,
      },
      "Public key fetched.",
    ).send(res);
  }),
};

export default usersController;
