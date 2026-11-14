import { StatusCodes } from "http-status-codes";
import * as messageRepository from "../../repositories/message.repository.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { assertE2EEReady } from "../security/message-e2ee.service.js";
import { deliverMessage } from "../delivery/message-delivery.service.js";
import ApiError from "../../../../shared/errors/api-error.js";
import { assertValidId } from "../../../../shared/utils/validators.js";
import {
  isValidObjectId,
  toObjectId,
} from "../../../../shared/utils/object-id.util.js";
import { assertValidCipher } from "../../utils/e2ee.js";
import { isExpired, isParticipantOf } from "../../utils/message-helpers.js";
import { MAX_FORWARD_TARGETS } from "../../constants/messages.constants.js";

export const forwardMessage = async (
  userId,
  messageId,
  { userIds: rawUserIds, receiverIds, encrypted, ciphertexts } = {},
) => {
  assertValidId(messageId, "message ID");

  const cipherMap = new Map();
  if (Array.isArray(ciphertexts)) {
    for (const c of ciphertexts) {
      if (c && c.userId) {
        cipherMap.set(String(c.userId), c);
      }
    }
  } else if (
    encrypted &&
    typeof encrypted === "object" &&
    !Array.isArray(encrypted)
  ) {
    for (const [k, v] of Object.entries(encrypted)) {
      if (v) {
        cipherMap.set(String(k), v);
      }
    }
  }

  const requestedIds = rawUserIds || receiverIds || [...cipherMap.keys()];
  const userIds = [...new Set((requestedIds || []).map(String))].filter(
    (id) => id !== userId.toString(),
  );

  if (!userIds.length || userIds.length > MAX_FORWARD_TARGETS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Choose 1 to ${MAX_FORWARD_TARGETS} recipients.`,
    );
  }
  userIds.forEach((id) => assertValidId(id, "recipient ID"));

  const original = await messageRepository.findById(messageId);
  if (
    !original ||
    original.isDeleted ||
    isExpired(original) ||
    !isParticipantOf(original, userId)
  ) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You cannot forward this message.",
    );
  }

  const o = original.toObject();
  const isEncrypted = Boolean(o.e2ee) && Boolean(o.text);

  const content = {
    text: isEncrypted ? undefined : o.text,
    image: o.image?.url ? o.image : undefined,
    file: o.file?.url ? o.file : undefined,
    audio: o.audio?.url ? o.audio : undefined,
    video: o.video?.url ? o.video : undefined,
    location:
      Number.isFinite(o.location?.lat) && Number.isFinite(o.location?.lng)
        ? {
            lat: o.location.lat,
            lng: o.location.lng,
            accuracy: o.location.accuracy,
            isLive: false,
          }
        : undefined,
    linkPreview: o.linkPreview?.url ? o.linkPreview : undefined,
    isForwarded: true,
  };

  const sent = [];
  const failed = [];
  for (const receiverId of userIds) {
    try {
      await assertCanMessage(userId, receiverId);

      const data = { ...content };
      if (isEncrypted) {
        const enc = cipherMap.get(receiverId);
        if (!enc) {
          throw new ApiError(
            StatusCodes.BAD_REQUEST,
            "Ciphertext missing for recipient.",
          );
        }
        assertValidCipher(enc.text, enc.iv);
        await assertE2EEReady(userId, receiverId);

        const sanitizedEnvelopes = [];
        if (Array.isArray(enc.keyEnvelopes)) {
          for (const k of enc.keyEnvelopes) {
            if (
              k &&
              k.deviceId &&
              k.wrappedKey &&
              k.iv &&
              isValidObjectId(k.userId)
            ) {
              sanitizedEnvelopes.push({
                deviceId: String(k.deviceId),
                userId: toObjectId(k.userId),
                wrappedKey: String(k.wrappedKey),
                iv: String(k.iv),
              });
            }
          }
        }

        data.text = enc.text;
        data.e2ee = true;
        data.iv = enc.iv;
        if (sanitizedEnvelopes.length > 0) {
          data.keyEnvelopes = sanitizedEnvelopes;
        }
      }

      const { payload } = await deliverMessage({
        senderId: userId,
        receiverId,
        data,
      });
      sent.push(payload);
    } catch (e) {
      failed.push(receiverId);
      if (process.env.NODE_ENV !== "production") {
        console.error("forward failed for", receiverId, e?.message || e);
      }
    }
  }

  return {
    sent,
    failed,
    message: failed.length
      ? `Forwarded to ${sent.length} chat(s). ${failed.length} failed.`
      : `Forwarded to ${sent.length} chat(s).`,
  };
};

const messageForwardService = {
  forwardMessage,
};

export default messageForwardService;
