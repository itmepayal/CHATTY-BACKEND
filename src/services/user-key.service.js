import mongoose from "mongoose";
import User from "../models/users.model.js";
import GroupKey from "../models/group-key.model.js";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";

export const savePublicKey = async (userId, body) => {
  const pk = body?.publicKey;

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

  if (same) {
    return {
      duplicate: true,
      publicKey: existing.publicKey,
      publicKeyUpdatedAt: existing.publicKeyUpdatedAt || null,
    };
  }

  const isReplacing = Boolean(existing.publicKey);

  if (isReplacing) {
    if (body.replace !== true) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        "A key already exists. Replacing it makes old encrypted messages unreadable on new devices.",
      );
    }
    if (!(await existing.isPassword(String(body.password || "")))) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Password is incorrect.");
    }
  }

  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: { publicKey, publicKeyUpdatedAt: new Date() } },
    { new: true },
  ).select("+publicKey");

  if (!updated) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  if (isReplacing) {
    await GroupKey.deleteMany({ userId });
  }

  return {
    duplicate: false,
    publicKey: updated.publicKey,
    publicKeyUpdatedAt: updated.publicKeyUpdatedAt,
  };
};

export const fetchUserPublicKey = async (targetId) => {
  if (!mongoose.Types.ObjectId.isValid(targetId))
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");

  const user = await User.findById(targetId).select(
    "+publicKey publicKeyUpdatedAt",
  );
  if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  if (!user.publicKey)
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      "This user has no encryption key yet.",
    );

  return {
    publicKey: user.publicKey,
    publicKeyUpdatedAt: user.publicKeyUpdatedAt || null,
  };
};
