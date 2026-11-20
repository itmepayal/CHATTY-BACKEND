import { StatusCodes } from "http-status-codes";
import * as scheduledMessageRepository from "../../repositories/scheduled-message.repository.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { assertE2EEReady } from "../core/message.service.js";
import { deliverMessage } from "../delivery/message-delivery.service.js";
import { sendGroupMessageService } from "../../../groups/services/group-message.service.js";
import { attachLinkPreview } from "../../../../shared/utils/link-preview.js";
import { getGroupAndMember } from "../../../groups/helpers/group.member.helpers.js";
import { io } from "../../../../infrastructure/socket/socket.js";
import ApiError from "../../../../shared/errors/api-error.js";
import { assertValidId } from "../../../../shared/utils/validators.js";
import {
  isValidObjectId,
  toObjectId,
} from "../../../../shared/utils/object-id.util.js";
import {
  parseBool,
  assertValidCipher,
  MAX_CIPHERTEXT_LENGTH,
  sanitizeAndValidateEnvelopes,
} from "../../utils/e2ee.js";
import { MAX_TEXT_LENGTH } from "../../constants/messages.constants.js";

const validateScheduleTime = (when) => {
  if (
    Number.isNaN(when.getTime()) ||
    when.getTime() < Date.now() + 30_000 ||
    when.getTime() > Date.now() + 30 * 86_400_000
  ) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Pick a time between 1 minute and 30 days from now.",
    );
  }
};

export const scheduleMessage = async (
  senderId,
  targetId,
  {
    text: rawText,
    encrypted,
    e2ee,
    iv,
    keyEnvelopes,
    groupKeyVersion,
    scheduledFor,
    clientRequestId,
    groupId: explicitGroupId,
    receiverId: explicitReceiverId,
    messageType: explicitMessageType,
    image,
    file,
    audio,
    video,
    recurrence,
    timezone,
  } = {},
) => {
  const text = rawText?.trim() || "";
  const wantsE2EE = parseBool(encrypted ?? e2ee);
  const when = new Date(scheduledFor);

  validateScheduleTime(when);

  const hasMedia = Boolean(image?.url || file?.url || audio?.url || video?.url);
  if (!text && !hasMedia) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Message must have text or an attachment.",
    );
  }

  // Determine if direct or group
  const isGroup =
    explicitMessageType === "group" ||
    Boolean(explicitGroupId) ||
    (!explicitReceiverId && targetId && !isValidObjectId(explicitReceiverId));

  let finalMessageType = "direct";
  let finalReceiverId = null;
  let finalGroupId = null;

  if (explicitMessageType === "group" || explicitGroupId) {
    finalMessageType = "group";
    finalGroupId = explicitGroupId || targetId;
  } else if (explicitReceiverId) {
    finalMessageType = "direct";
    finalReceiverId = explicitReceiverId;
  } else if (targetId) {
    // Check if target is a group or user
    // If explicitGroupId was not passed, we can check if targetId matches a group or user
    finalReceiverId = targetId;
  }

  // Idempotency check: if clientRequestId provided, check if already exists
  if (clientRequestId) {
    const existing = await scheduledMessageRepository.findOne({
      senderId,
      clientRequestId: String(clientRequestId),
    });
    if (existing) {
      return { doc: existing, message: "Message scheduled (idempotent)." };
    }
  }

  const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;
  if (!text || text.length > maxLen) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      wantsE2EE
        ? "Encrypted payload is invalid or too large."
        : `Text must be 1-${MAX_TEXT_LENGTH} characters.`,
    );
  }

  let sanitizedEnvelopes = [];

  if (finalMessageType === "group" || finalGroupId) {
    assertValidId(finalGroupId, "group ID");
    const { group } = await getGroupAndMember(finalGroupId, senderId);
    if (!group) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Group not found.");
    }
    finalMessageType = "group";
    finalReceiverId = null;

    if (wantsE2EE) {
      assertValidCipher(text, iv);
    }
  } else {
    // Direct message
    finalMessageType = "direct";
    assertValidId(finalReceiverId, "receiver ID");

    if (finalReceiverId.toString() === senderId.toString()) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You cannot message yourself.",
      );
    }

    if (wantsE2EE) {
      assertValidCipher(text, iv);
      if (!Array.isArray(keyEnvelopes) || keyEnvelopes.length === 0) {
        throw new ApiError(
          StatusCodes.BAD_REQUEST,
          "Key envelopes are required for encrypted scheduled message.",
        );
      }
    }

    await assertCanMessage(senderId, finalReceiverId);
    if (wantsE2EE) await assertE2EEReady(senderId, finalReceiverId);

    if (wantsE2EE) {
      sanitizedEnvelopes = sanitizeAndValidateEnvelopes(keyEnvelopes, {
        senderId,
        receiverId: finalReceiverId,
        requireReceiverEnvelope: true,
      });
    }
  }

  const doc = await scheduledMessageRepository.create({
    senderId,
    messageType: finalMessageType,
    ...(finalReceiverId ? { receiverId: finalReceiverId } : {}),
    ...(finalGroupId ? { groupId: finalGroupId } : {}),
    text,
    image,
    file,
    audio,
    video,
    timezone: timezone || "UTC",
    ...(recurrence ? { recurrence } : {}),
    scheduledFor: when,
    clientRequestId: clientRequestId ? String(clientRequestId) : undefined,
    ...(wantsE2EE
      ? {
          e2ee: true,
          iv,
          ...(finalMessageType === "group"
            ? {
                groupKeyVersion:
                  groupKeyVersion != null ? Number(groupKeyVersion) : null,
              }
            : { keyEnvelopes: sanitizedEnvelopes }),
        }
      : {}),
  });

  // Real-time Socket sync
  try {
    io.to(senderId.toString()).emit("scheduled:created", doc);
  } catch (_e) {}

  return { doc, message: "Message scheduled." };
};

export const getScheduled = async (userId, { to, groupId, type } = {}) => {
  const filter = {
    senderId: userId,
    status: { $in: ["pending", "scheduled"] },
  };
  if (to && isValidObjectId(to)) {
    filter.receiverId = to;
  }
  if (groupId && isValidObjectId(groupId)) {
    filter.groupId = groupId;
  }
  if (type) {
    filter.messageType = type;
  }

  const list = await scheduledMessageRepository.findSorted(filter);

  return { list, message: "Scheduled messages." };
};

export const updateScheduled = async (
  userId,
  scheduleId,
  {
    text: rawText,
    encrypted,
    e2ee,
    iv,
    keyEnvelopes,
    groupKeyVersion,
    scheduledFor,
  } = {},
) => {
  assertValidId(scheduleId, "schedule ID");

  const existing = await scheduledMessageRepository.findById(scheduleId);
  if (!existing || existing.senderId.toString() !== userId.toString()) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Scheduled message not found.");
  }
  if (!["pending", "scheduled"].includes(existing.status)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot edit a scheduled message with status '${existing.status}'.`,
    );
  }

  const updates = {};

  if (scheduledFor) {
    const when = new Date(scheduledFor);
    validateScheduleTime(when);
    updates.scheduledFor = when;
  }

  if (rawText !== undefined) {
    const text = rawText?.trim();
    const wantsE2EE = parseBool(encrypted ?? e2ee ?? existing.e2ee);
    const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;
    if (!text || text.length > maxLen) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        wantsE2EE
          ? "Encrypted payload is invalid or too large."
          : `Text must be 1-${MAX_TEXT_LENGTH} characters.`,
      );
    }
    updates.text = text;

    if (wantsE2EE) {
      updates.e2ee = true;
      if (iv) updates.iv = iv;
      if (existing.messageType === "group") {
        if (groupKeyVersion != null)
          updates.groupKeyVersion = Number(groupKeyVersion);
      } else if (Array.isArray(keyEnvelopes) && keyEnvelopes.length > 0) {
        const sanitized = [];
        for (const env of keyEnvelopes) {
          if (
            env &&
            env.deviceId &&
            env.wrappedKey &&
            env.iv &&
            isValidObjectId(env.userId)
          ) {
            sanitized.push({
              deviceId: String(env.deviceId),
              userId: toObjectId(env.userId),
              wrappedKey: String(env.wrappedKey),
              iv: String(env.iv),
            });
          }
        }
        if (sanitized.length > 0) updates.keyEnvelopes = sanitized;
      }
    }
  }

  const updatedDoc = await scheduledMessageRepository.findOneAndUpdate(
    {
      _id: scheduleId,
      senderId: userId,
      status: { $in: ["pending", "scheduled"] },
    },
    { $set: updates },
    { new: true },
  );

  if (!updatedDoc) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Scheduled message not found.");
  }

  try {
    io.to(userId.toString()).emit("scheduled:updated", updatedDoc);
  } catch (_e) {}

  return { doc: updatedDoc, message: "Scheduled message updated." };
};

export const cancelScheduled = async (userId, scheduleId) => {
  assertValidId(scheduleId, "schedule ID");

  const doc = await scheduledMessageRepository.findOneAndUpdate(
    {
      _id: scheduleId,
      senderId: userId,
      status: { $in: ["pending", "scheduled"] },
    },
    { status: "cancelled" },
  );
  if (!doc) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Scheduled message not found.");
  }

  try {
    io.to(userId.toString()).emit("scheduled:cancelled", {
      id: doc._id,
      receiverId: doc.receiverId,
      groupId: doc.groupId,
    });
  } catch (_e) {}

  return { id: doc._id, message: "Scheduled message cancelled." };
};

export const sendScheduledNow = async (userId, scheduleId) => {
  assertValidId(scheduleId, "schedule ID");

  // Atomically claim the scheduled message from pending or scheduled status
  const claimed = await scheduledMessageRepository.findOneAndUpdate(
    {
      _id: scheduleId,
      senderId: userId,
      status: { $in: ["pending", "scheduled"] },
    },
    {
      $set: {
        status: "processing",
        processingStartedAt: new Date(),
      },
    },
    { new: true },
  );

  if (!claimed) {
    const existing = await scheduledMessageRepository.findById(scheduleId);
    if (!existing || existing.senderId.toString() !== userId.toString()) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Scheduled message not found.");
    }
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Cannot send scheduled message with status '${existing.status}'.`,
    );
  }

  try {
    if (claimed.messageType === "group") {
      const { group } = await getGroupAndMember(
        claimed.groupId,
        claimed.senderId,
      );

      const result = await sendGroupMessageService({
        group,
        me: claimed.senderId,
        body: {
          text: claimed.text,
          encrypted: claimed.e2ee ? "true" : undefined,
          e2ee: claimed.e2ee ? "true" : undefined,
          ...(claimed.iv ? { iv: claimed.iv } : {}),
          ...(claimed.groupKeyVersion != null
            ? { keyVersion: String(claimed.groupKeyVersion) }
            : {}),
        },
      });

      const sentId = result?.payload?._id || result?.payload?.id;

      await scheduledMessageRepository.findOneAndUpdate(
        { _id: claimed._id },
        { status: "sent", sentMessageId: sentId },
      );

      try {
        io.to(claimed.senderId.toString()).emit("scheduled:sent", {
          scheduleId: claimed._id,
          messageId: sentId,
          groupId: claimed.groupId,
        });
      } catch (_err) {}

      return { doc: claimed, message: "Scheduled message sent immediately." };
    } else {
      await assertCanMessage(claimed.senderId, claimed.receiverId);

      const { message } = await deliverMessage({
        senderId: claimed.senderId,
        receiverId: claimed.receiverId,
        data: {
          text: claimed.text,
          e2ee: Boolean(claimed.e2ee),
          ...(claimed.iv ? { iv: claimed.iv } : {}),
          ...(claimed.e2ee &&
          Array.isArray(claimed.keyEnvelopes) &&
          claimed.keyEnvelopes.length > 0
            ? { keyEnvelopes: claimed.keyEnvelopes }
            : {}),
        },
      });

      if (!claimed.e2ee) attachLinkPreview(message);

      await scheduledMessageRepository.findOneAndUpdate(
        { _id: claimed._id },
        { status: "sent", sentMessageId: message._id },
      );

      try {
        io.to(claimed.senderId.toString()).emit("scheduled:sent", {
          scheduleId: claimed._id,
          messageId: message._id,
          receiverId: claimed.receiverId,
        });
      } catch (_err) {}

      return { doc: claimed, message: "Scheduled message sent immediately." };
    }
  } catch (err) {
    const errMsg = String(err?.message || err).slice(0, 200);
    await scheduledMessageRepository.findOneAndUpdate(
      { _id: claimed._id },
      { status: "failed", error: errMsg },
    );
    try {
      io.to(claimed.senderId.toString()).emit("scheduled:failed", {
        scheduleId: claimed._id,
        error: errMsg,
        receiverId: claimed.receiverId,
        groupId: claimed.groupId,
      });
    } catch (_err) {}
    throw err;
  }
};

const messageScheduleService = {
  scheduleMessage,
  getScheduled,
  updateScheduled,
  cancelScheduled,
  sendScheduledNow,
};

export default messageScheduleService;
