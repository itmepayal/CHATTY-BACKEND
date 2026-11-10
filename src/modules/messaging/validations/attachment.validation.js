import { z } from "zod";

/**
 * Validation schema for attachment metadata.
 */
export const attachmentMetadataSchema = z
  .object({
    url: z.string().url("Attachment must be a valid URL.").optional(),
    fileType: z.string().optional(),
    fileName: z.string().optional(),
    fileSize: z.number().nonnegative().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough();

/**
 * Validation schema for attachment upload payload.
 */
export const attachmentUploadSchema = z
  .object({
    type: z.enum(["image", "video", "audio", "document", "raw"]).optional(),
    caption: z.string().max(1000, "Caption cannot exceed 1000 characters.").optional(),
  })
  .passthrough();
