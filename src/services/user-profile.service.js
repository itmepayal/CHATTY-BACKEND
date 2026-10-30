import User from "../models/users.model.js";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import {
  deleteFileToCloudinary,
  uploadFileToCloudinary,
} from "../config/cloudinary.config.js";
import formatUser from "../utils/format-user.js";
import { RULES } from "../utils/profile-rules.js";
import { EDITABLE_FIELDS } from "../constants/constants.js";

export const updateProfileData = async (userId, body) => {
  const $set = {};
  const $unset = {};

  for (const field of EDITABLE_FIELDS) {
    const raw = body[field];
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

  return { user: formatUser(updatedUser) };
};

export const updateUserAvatar = async (userId, file) => {
  if (!file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "No file uploaded.");
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const avatar = await uploadFileToCloudinary(file?.path);
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

  return { user: formatUser(updatedUser) };
};

export const deleteUserAvatar = async (userId) => {
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

  return { user: formatUser(updatedUser) };
};

export const fetchCurrentUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }
  return { user: formatUser(user) };
};
