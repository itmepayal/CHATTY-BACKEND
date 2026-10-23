import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import { StatusCodes } from "http-status-codes";
import User from "../models/users.model.js";
import Session from "../models/session.model.js";
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import GroupMessage from "../models/groupmessage.model.js";
import { deleteFileToCloudinary } from "../config/cloudinary.config.js";
import { io, privacyByUser, broadcastOnline } from "../lib/socket.js";
import { options as cookieOptions } from "../constants/constant.js";
import { verifyTotpToken, consumeRecoveryCode } from "../utils/totp.js";
import {
  checkRateLimit,
  recordFail,
  clearFail,
} from "./twoFactor.controller.js";

const CONFIRM_WORD = "DELETE";
const HAS_IMAGE = { "image.public_id": { $exists: true, $nin: ["", null] } };

const safeDeleteFiles = async (publicIds) => {
  const ids = [...new Set(publicIds.filter(Boolean))];
  const results = await Promise.allSettled(
    ids.map((id) => deleteFileToCloudinary(id)),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error("[deleteAccount] cloudinary delete failed:", ids[index]);
    }
  });
};

const byJoinedAt = (a, b) => new Date(a.joinedAt) - new Date(b.joinedAt);

const detachUserFromGroups = async (userId) => {
  const uid = String(userId);
  const groups = await Group.find({ "members.userId": userId })
    .select("_id owner members avatar")
    .lean();

  const ops = [];
  const deletedGroupIds = [];
  const deletedGroupAvatars = [];
  const notices = [];

  for (const group of groups) {
    const others = group.members.filter(
      (member) => String(member.userId) !== uid,
    );
    const recipients = others.map((member) => String(member.userId));
    const groupId = String(group._id);

    if (!others.length) {
      deletedGroupIds.push(group._id);
      if (group.avatar?.public_id)
        deletedGroupAvatars.push(group.avatar.public_id);
      continue;
    }

    if (String(group.owner) === uid) {
      const successor =
        others
          .filter((member) => member.role === "admin")
          .sort(byJoinedAt)[0] || [...others].sort(byJoinedAt)[0];

      ops.push({
        updateOne: {
          filter: { _id: group._id, owner: userId },
          update: {
            $set: {
              owner: successor.userId,
              "members.$[m].role": "admin",
            },
          },
          arrayFilters: [{ "m.userId": successor.userId }],
        },
      });
      notices.push({
        event: "group:owner-changed",
        payload: { groupId: groupId, ownerId: String(successor.userId) },
        recipients,
      });
    }

    ops.push({
      updateOne: {
        filter: { _id: group._id },
        update: { $pull: { members: { userId } } },
      },
    });
    notices.push({
      event: "group:member-removed",
      payload: { groupId: groupId, userId: uid },
      recipients,
    });
  }

  if (ops.length) await Group.bulkWrite(ops, { ordered: true });

  return { deletedGroupIds, deletedGroupAvatars, notices };
};

const validateDeletionConfirmation = (confirmation) => {
  if (confirmation !== CONFIRM_WORD) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Type ${CONFIRM_WORD} exactly to confirm.`,
    );
  }
};

const validatePasswordInput = (password) => {
  if (!password || typeof password !== "string") {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Password is required.");
  }
};

const validateDeletion2FA = async ({ user, code, useRecoveryCode }) => {
  if (!user.twoFactorEnabled) return;

  if (!code) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Authenticator or recovery code is required.",
    );
  }

  if (useRecoveryCode) {
    const idx = await consumeRecoveryCode(
      String(code).trim(),
      user.recoveryCodes || [],
    );
    if (idx === -1) {
      recordFail(user._id);
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid recovery code.");
    }
    return;
  }

  if (!verifyTotpToken(String(code).trim(), user.twoFactorSecret)) {
    recordFail(user._id);
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Invalid or expired authenticator code.",
    );
  }
};

const getGroupCleanupFilter = ({ userId, deletedGroupIds }) => {
  if (deletedGroupIds.length) {
    return {
      $or: [{ senderId: userId }, { groupId: { $in: deletedGroupIds } }],
    };
  }

  return { senderId: userId };
};

const emitAccountDeletionNotifications = ({ notices, userId }) => {
  for (const { event, payload, recipients } of notices) {
    for (const recipientId of recipients)
      io.to(recipientId).emit(event, payload);
  }

  io.emit("user:deleted", { userId: String(userId) });
  io.to(String(userId)).emit("account:deleted");
  io.in(String(userId)).disconnectSockets(true);
};

export const deleteAccount = asyncHandler(async (req, res) => {
  const { confirmation, password, code, useRecoveryCode } = req.body;

  validateDeletionConfirmation(confirmation);
  validatePasswordInput(password);

  const user = await User.findById(req.user._id).select(
    "+password +twoFactorSecret +recoveryCodes",
  );

  if (!user) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  checkRateLimit(user._id);

  if (!(await user.isPassword(password))) {
    recordFail(user._id);
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Incorrect password.");
  }

  await validateDeletion2FA({ user, code, useRecoveryCode });
  clearFail(user._id);

  const userId = user._id;
  const avatarPublicId = user.avatar?.public_id;

  const { deletedGroupIds, deletedGroupAvatars, notices } =
    await detachUserFromGroups(userId);

  const groupCleanupFilter = getGroupCleanupFilter({
    userId,
    deletedGroupIds,
  });

  const groupImages = await GroupMessage.find({
    ...groupCleanupFilter,
    ...HAS_IMAGE,
  })
    .select("image.public_id")
    .lean();

  await safeDeleteFiles([
    ...groupImages.map((message) => message.image?.public_id),
    ...deletedGroupAvatars,
  ]);

  await GroupMessage.deleteMany(groupCleanupFilter);
  if (deletedGroupIds.length) {
    await Group.deleteMany({ _id: { $in: deletedGroupIds } });
  }

  await GroupMessage.updateMany(
    { $or: [{ readBy: userId }, { silentReadBy: userId }] },
    { $pull: { readBy: userId, silentReadBy: userId } },
  );

  const dmFilter = { $or: [{ senderId: userId }, { receiverId: userId }] };
  const dmImages = await Message.find({ ...dmFilter, ...HAS_IMAGE })
    .select("image.public_id")
    .lean();

  await safeDeleteFiles(dmImages.map((message) => message.image?.public_id));
  await Message.deleteMany(dmFilter);

  await Session.deleteMany({ userId });
  await User.updateMany(
    { $or: [{ blockedUsers: userId }, { favorites: userId }] },
    { $pull: { blockedUsers: userId, favorites: userId } },
  );

  await safeDeleteFiles([avatarPublicId]);
  await User.findByIdAndDelete(userId);

  emitAccountDeletionNotifications({ notices, userId });
  privacyByUser.delete(String(userId));
  broadcastOnline();

  res
    .clearCookie("accessToken", cookieOptions)
    .clearCookie("refreshToken", cookieOptions);

  return new ApiResponse(
    StatusCodes.OK,
    null,
    "Your account has been permanently deleted.",
  ).send(res);
});
