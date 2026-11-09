import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import Message from "../../models/message.model.js";
import { assertValidId } from "../../utils/validators.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { assertE2EEReady, deliverMessage } from "../message.service.js";
import { assertValidCipher } from "../../utils/e2ee.js";
import { MAX_FORWARD_TARGETS } from "../../constants/messages.constants.js";
import { isExpired, isParticipantOf } from "../../utils/message-helpers.js";

/**
 * Moved from messages.controller.js:L415-507
 */
export const forwardMessage = async (
  userId,
  messageId,
  { userIds: rawUserIds, encrypted } = {},
) => {
  assertValidId(messageId, "message ID");

  const userIds = [...new Set((rawUserIds || []).map(String))].filter(
    (id) => id !== userId.toString(),
  );

  if (!userIds.length || userIds.length > MAX_FORWARD_TARGETS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Choose 1 to ${MAX_FORWARD_TARGETS} recipients.`,
    );
  }
  userIds.forEach((id) => assertValidId(id, "recipient ID"));

  const original = await Message.findById(messageId);
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
  const encryptedFor =
    encrypted && typeof encrypted === "object" ? encrypted : {};

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
        const enc = encryptedFor[receiverId];
        assertValidCipher(enc?.text, enc?.iv);
        await assertE2EEReady(userId, receiverId);
        data.text = enc.text;
        data.e2ee = true;
        data.iv = enc.iv;
      }

      const { payload } = await deliverMessage({
        senderId: userId,
        receiverId,
        data,
      });
      sent.push(payload);
    } catch (e) {
      failed.push(receiverId);
      console.error("forward failed for", receiverId, e?.message || e);
    }
  }

  return {
    sent,
    message: failed.length
      ? `Forwarded to ${sent.length} chat(s). ${failed.length} failed.`
      : `Forwarded to ${sent.length} chat(s).`,
  };
};
