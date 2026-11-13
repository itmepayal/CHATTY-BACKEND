/**
 * Message Send Service
 * Orchestrates sending direct 1:1 messages, handling validation, attachments, E2EE, spam prevention, and delivery.
 */

import fs from "fs";
import { StatusCodes } from "http-status-codes";
import * as messageRepository from "../../repositories/message.repository.js";
import { assertCanMessage } from "../../utils/chat-guard.js";
import { assertE2EEReady } from "../security/message-e2ee.service.js";
import { assertNotSpamming } from "../security/message-spam.service.js";
import { processAttachment } from "../attachments/message-attachment.service.js";
import { deliverMessage } from "../delivery/message-delivery.service.js";
import ApiError from "../../../../shared/errors/api-error.js";
import { assertValidId } from "../../../../shared/utils/validators.js";
import { isBetween, formatMessage } from "../../utils/message-helpers.js";
import { attachLinkPreview } from "../../../../shared/utils/link-preview.js";
import { deleteAttachmentMedia } from "../../utils/message-cleanup.js";
import {
  parseBool,
  assertValidCipher,
  MAX_CIPHERTEXT_LENGTH,
} from "../../utils/e2ee.js";
import { MAX_TEXT_LENGTH } from "../../constants/messages.constants.js";

export const sendMessage = async (
  senderId,
  receiverId,
  {
    text,
    clientId,
    isVoice,
    isVideo,
    duration,
    iv,
    replyTo: replyToId,
    encrypted,
    e2ee,
    keyEnvelopes,
  } = {},
  file,
) => {
  assertValidId(receiverId, "receiver ID");

  if (receiverId.toString() === senderId.toString()) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "You cannot send a message to yourself.",
    );
  }

  const trimmedText = text?.trim();

  if (!trimmedText && !file) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
  }

  const isEncryptedReq = parseBool(encrypted ?? e2ee);

  if (isEncryptedReq && file) {
    if (file.path) fs.unlink(file.path, () => {});
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "End-to-end encrypted media is not supported. Please send media in standard mode or send text only.",
    );
  }

  const wantsE2EE = isEncryptedReq && Boolean(trimmedText);
  const maxLen = wantsE2EE ? MAX_CIPHERTEXT_LENGTH : MAX_TEXT_LENGTH;

  if (trimmedText && trimmedText.length > maxLen) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      wantsE2EE
        ? "Message is too long."
        : `Message is too long (max ${MAX_TEXT_LENGTH} characters).`,
    );
  }
  if (wantsE2EE) {
    assertValidCipher(trimmedText, iv);
  }

  if (clientId) {
    const existing = await messageRepository.findOne({ senderId, clientId });
    if (existing) {
      return {
        status: StatusCodes.OK,
        payload: formatMessage(existing),
        message: "Message already sent.",
      };
    }
  }

  await assertCanMessage(senderId, receiverId);
  if (wantsE2EE) await assertE2EEReady(senderId, receiverId);
  await assertNotSpamming(
    senderId,
    receiverId,
    wantsE2EE ? undefined : trimmedText,
  );

  let replyTo;
  if (replyToId) {
    assertValidId(replyToId, "reply ID");
    const original = await messageRepository
      .findById(replyToId)
      .select("senderId receiverId isDeleted");
    if (
      !original ||
      original.isDeleted ||
      !isBetween(original, senderId, receiverId)
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Cannot reply to this message.",
      );
    }
    replyTo = original._id;
  }

  const attachment = await processAttachment(file, {
    isVoice: parseBool(isVoice),
    isVideo: parseBool(isVideo),
    duration,
  });
  const {
    image: uploadedImage,
    file: uploadedFile,
    audio: uploadedAudio,
    video: uploadedVideo,
  } = attachment;

  let parsedEnvelopes = keyEnvelopes;
  if (typeof keyEnvelopes === "string") {
    try {
      parsedEnvelopes = JSON.parse(keyEnvelopes);
    } catch {
      parsedEnvelopes = [];
    }
  }

  let result;
  try {
    result = await deliverMessage({
      senderId,
      receiverId,
      data: {
        text: trimmedText,
        clientId: clientId || undefined,
        image: uploadedImage || undefined,
        file: uploadedFile || undefined,
        audio: uploadedAudio || undefined,
        video: uploadedVideo || undefined,
        replyTo,
        ...(wantsE2EE
          ? {
              e2ee: true,
              iv,
              ...(Array.isArray(parsedEnvelopes) && parsedEnvelopes.length > 0
                ? { keyEnvelopes: parsedEnvelopes }
                : {}),
            }
          : {}),
      },
    });
  } catch (error) {
    await deleteAttachmentMedia(attachment);

    if (error?.code === 11000 && clientId) {
      const existing = await messageRepository.findOne({ senderId, clientId });
      if (existing) {
        return {
          status: StatusCodes.OK,
          payload: formatMessage(existing),
          message: "Message already sent.",
        };
      }
    }
    throw error;
  }

  const { message, payload } = result;

  if (!wantsE2EE) attachLinkPreview(message);

  return {
    status: StatusCodes.CREATED,
    payload,
    message: "Message sent successfully.",
  };
};

const messageSendService = {
  sendMessage,
};

export default messageSendService;
