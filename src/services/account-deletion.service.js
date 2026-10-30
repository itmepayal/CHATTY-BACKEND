import mongoose from "mongoose";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";
import User from "../models/users.model.js";
import Session from "../models/session.model.js";
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import GroupMessage from "../models/group-message.model.js";
import { deleteFileToCloudinary } from "../config/cloudinary.config.js";
import { io, privacyByUser, broadcastOnline } from "../lib/socket.js";
import { verifyTotpToken, consumeRecoveryCode } from "../utils/totp.js";
import {
  checkRateLimit,
  recordFail,
  clearFail,
} from "../utils/two-factor-rate-limit.js";
import { CONFIRM_WORD } from "../constants/constants.js";

const getResourceType = (attachment, fallback = "image") =>
  attachment?.resourceType || fallback;

const extractAssets = (msg) => {
  const assets = [];

  if (msg.image?.public_id)
    assets.push({ publicId: msg.image.public_id, resourceType: "image" });

  if (msg.file?.public_id)
    assets.push({
      publicId: msg.file.public_id,
      resourceType: getResourceType(msg.file, "raw"),
    });

  if (msg.audio?.public_id)
    assets.push({
      publicId: msg.audio.public_id,
      resourceType: getResourceType(msg.audio, "video"),
    });

  if (msg.video?.public_id)
    assets.push({
      publicId: msg.video.public_id,
      resourceType: getResourceType(msg.video, "video"),
    });

  return assets;
};

const safeDeleteAssets = async (assets) => {
  const seen = new Set();
  const unique = assets.filter(({ publicId }) => {
    if (!publicId || seen.has(publicId)) return false;
    seen.add(publicId);
    return true;
  });

  const results = await Promise.allSettled(
    unique.map(({ publicId, resourceType }) =>
      deleteFileToCloudinary(publicId, resourceType),
    ),
  );

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(
        "[deleteAccount] cloudinary delete failed:",
        unique[index].publicId,
        "type:",
        unique[index].resourceType,
        "reason:",
        result.reason?.message || result.reason,
      );
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
        deletedGroupAvatars.push({
          publicId: group.avatar.public_id,
          resourceType: "image",
        });
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

export const validateDeletionConfirmation = (confirmation) => {
  if (confirmation !== CONFIRM_WORD) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Type ${CONFIRM_WORD} exactly to confirm.`,
    );
  }
};

export const validatePasswordInput = (password) => {
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

const emitAccountDeletionNotifications = ({ notices, userId, contactIds }) => {
  for (const { event, payload, recipients } of notices) {
    for (const recipientId of recipients)
      io.to(recipientId).emit(event, payload);
  }

  const notified = new Set();
  for (const contactId of contactIds) {
    const id = String(contactId);
    if (!notified.has(id)) {
      notified.add(id);
      io.to(id).emit("user:deleted", { userId: String(userId) });
    }
  }

  io.to(String(userId)).emit("account:deleted");
  io.in(String(userId)).disconnectSockets(true);
};

export const deleteUserAccount = async ({
  userId,
  confirmation,
  password,
  code,
  useRecoveryCode,
}) => {
  validateDeletionConfirmation(confirmation);
  validatePasswordInput(password);

  const user = await User.findById(userId).select(
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

  const avatarPublicId = user.avatar?.public_id;

  const { deletedGroupIds, deletedGroupAvatars, notices } =
    await detachUserFromGroups(userId);

  const groupCleanupFilter = getGroupCleanupFilter({ userId, deletedGroupIds });

  const HAS_ATTACHMENT = {
    $or: [
      { "image.public_id": { $exists: true, $nin: ["", null] } },
      { "file.public_id": { $exists: true, $nin: ["", null] } },
      { "audio.public_id": { $exists: true, $nin: ["", null] } },
      { "video.public_id": { $exists: true, $nin: ["", null] } },
    ],
  };

  const groupMessagesWithAssets = await GroupMessage.find({
    ...groupCleanupFilter,
    ...HAS_ATTACHMENT,
  })
    .select(
      "image.public_id file.public_id file.resourceType audio.public_id audio.resourceType video.public_id video.resourceType",
    )
    .lean();

  const groupAssets = [
    ...groupMessagesWithAssets.flatMap(extractAssets),
    ...deletedGroupAvatars,
  ];

  const dmFilter = { $or: [{ senderId: userId }, { receiverId: userId }] };
  const dmMessagesWithAssets = await Message.find({
    ...dmFilter,
    ...HAS_ATTACHMENT,
  })
    .select(
      "image.public_id file.public_id file.resourceType audio.public_id audio.resourceType video.public_id video.resourceType",
    )
    .lean();

  const dmAssets = dmMessagesWithAssets.flatMap(extractAssets);

  const dmPartners = await Message.distinct("senderId", {
    receiverId: userId,
  }).then(async (senderIds) => {
    const receiverIds = await Message.distinct("receiverId", {
      senderId: userId,
    });
    return [...new Set([...senderIds, ...receiverIds].map(String))];
  });

  let session = null;
  let useTransaction = false;

  try {
    session = await mongoose.startSession();
    session.startTransaction();
    useTransaction = true;
  } catch (err) {
    console.warn(
      "[deleteAccount] MongoDB session unavailable — running without transaction.",
      "Ensure a replica set is configured for atomic account deletion.",
      err?.message,
    );
  }

  const sessionOpt = useTransaction ? { session } : {};

  try {
    await GroupMessage.updateMany(
      { $or: [{ readBy: userId }, { silentReadBy: userId }] },
      { $pull: { readBy: userId, silentReadBy: userId } },
      sessionOpt,
    );

    await GroupMessage.deleteMany(groupCleanupFilter, sessionOpt);

    if (deletedGroupIds.length) {
      await Group.deleteMany({ _id: { $in: deletedGroupIds } }, sessionOpt);
    }

    await Message.deleteMany(dmFilter, sessionOpt);

    await Session.deleteMany({ userId }, sessionOpt);

    await User.updateMany(
      { $or: [{ blockedUsers: userId }, { favorites: userId }] },
      { $pull: { blockedUsers: userId, favorites: userId } },
      sessionOpt,
    );

    await User.findByIdAndDelete(userId, sessionOpt);

    if (useTransaction) {
      await session.commitTransaction();
    }
  } catch (err) {
    if (useTransaction) {
      await session
        .abortTransaction()
        .catch((abortErr) =>
          console.error(
            "[deleteAccount] abortTransaction failed:",
            abortErr?.message,
          ),
        );
    }
    throw err;
  } finally {
    if (session) session.endSession().catch(() => {});
  }

  await safeDeleteAssets([
    ...groupAssets,
    ...dmAssets,
    ...(avatarPublicId
      ? [{ publicId: avatarPublicId, resourceType: "image" }]
      : []),
  ]);

  const groupRecipients = notices.flatMap((n) => n.recipients);
  const contactIds = [...new Set([...dmPartners, ...groupRecipients])];

  emitAccountDeletionNotifications({ notices, userId, contactIds });
  privacyByUser.delete(String(userId));
  broadcastOnline();
};
