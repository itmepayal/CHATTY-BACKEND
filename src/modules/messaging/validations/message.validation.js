import { z } from "zod";
import { objectIdSchema } from "../../../shared/validators/object-id.validation.js";

export const messageIdParamSchema = z.object({
  messageId: objectIdSchema,
});

export const receiverIdParamSchema = z.object({
  id: objectIdSchema,
});

export const scheduleIdParamSchema = z.object({
  scheduleId: objectIdSchema,
});

export const sendMessageSchema = z
  .object({
    text: z.string().optional(),
    clientId: z.string().optional(),
    isVoice: z.union([z.boolean(), z.string()]).optional(),
    isVideo: z.union([z.boolean(), z.string()]).optional(),
    duration: z.union([z.number(), z.string()]).optional(),
    iv: z.string().optional(),
    replyTo: z.string().optional(),
    encrypted: z.union([z.boolean(), z.string()]).optional(),
    e2ee: z.union([z.boolean(), z.string()]).optional(),
  })
  .passthrough();

export const forwardMessageSchema = z
  .object({
    receiverId: z.union([objectIdSchema, z.array(objectIdSchema)]).optional(),
    receiverIds: z.array(objectIdSchema).optional(),
  })
  .passthrough();

export const editMessageSchema = z
  .object({
    text: z
      .string({ required_error: "Text is required." })
      .min(1, "Text is required."),
  })
  .passthrough();

export const reactMessageSchema = z
  .object({
    emoji: z
      .string({ required_error: "Emoji is required." })
      .min(1, "Emoji is required."),
  })
  .passthrough();

export const scheduleMessageSchema = z
  .object({
    scheduledFor: z.union([z.string(), z.number(), z.date()]),
    text: z.string().optional(),
  })
  .passthrough();

export const shareLocationSchema = z
  .object({
    latitude: z.number({ required_error: "Latitude is required." }),
    longitude: z.number({ required_error: "Longitude is required." }),
    duration: z.number().optional(),
  })
  .passthrough();

export const reportUserSchema = z
  .object({
    reason: z
      .string({ required_error: "Reason is required." })
      .min(1, "Reason is required."),
    description: z.string().optional(),
  })
  .passthrough();

export const disappearingModeSchema = z
  .object({
    disappearingMode: z.union([z.number(), z.string()]).optional(),
    duration: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();
