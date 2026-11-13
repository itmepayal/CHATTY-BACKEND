import { z } from "zod";
import { isValidObjectId } from "../../../shared/utils/object-id.util.js";
import {
  MAX_BACKUP_SIZE_BYTES,
  MIN_BACKUP_SIZE_BYTES,
  MAX_BATCH_PUBLIC_KEYS,
  E2EE_RESET_CONFIRM_KEYWORD,
  E2EE_ERROR_MESSAGES,
} from "../constants/e2ee.constants.js";

export const publicKeySchema = z.object({
  kty: z.literal("EC", {
    errorMap: () => ({ message: "Key type (kty) must be 'EC'." }),
  }),
  crv: z.literal("P-256", {
    errorMap: () => ({ message: "Curve (crv) must be 'P-256'." }),
  }),
  x: z
    .string({ required_error: "Public key x coordinate is required." })
    .trim()
    .min(1, "Public key x coordinate cannot be empty.")
    .max(256, "Public key x coordinate exceeds maximum length."),
  y: z
    .string({ required_error: "Public key y coordinate is required." })
    .trim()
    .min(1, "Public key y coordinate cannot be empty.")
    .max(256, "Public key y coordinate exceeds maximum length."),
});

export const encryptedPrivateKeySchema = z
  .union([z.string(), z.record(z.any())])
  .transform((val) => {
    if (typeof val === "object" && val !== null) {
      return JSON.stringify(val);
    }
    return String(val).trim();
  })
  .refine((val) => val.length >= MIN_BACKUP_SIZE_BYTES, {
    message: E2EE_ERROR_MESSAGES.BACKUP_TOO_SHORT,
  })
  .refine((val) => val.length <= MAX_BACKUP_SIZE_BYTES, {
    message: E2EE_ERROR_MESSAGES.BACKUP_SIZE_EXCEEDED,
  });

export const registerKeysSchema = z.object({
  publicKey: publicKeySchema,
  encryptedPrivateKey: encryptedPrivateKeySchema,
  backupVersion: z.number().int().min(1).max(100).optional().default(1),
});

export const updateBackupSchema = z.object({
  encryptedPrivateKey: encryptedPrivateKeySchema,
  backupVersion: z.number().int().min(1).max(100).optional(),
});

export const resetKeysSchema = z.object({
  password: z
    .string({ required_error: E2EE_ERROR_MESSAGES.PASSWORD_REQUIRED })
    .min(1, E2EE_ERROR_MESSAGES.PASSWORD_REQUIRED),
  confirm: z.literal(E2EE_RESET_CONFIRM_KEYWORD, {
    errorMap: () => ({ message: E2EE_ERROR_MESSAGES.CONFIRMATION_REQUIRED }),
  }),
});

export const batchPublicKeysSchema = z.object({
  userIds: z
    .array(
      z.string().refine((id) => isValidObjectId(id), {
        message: E2EE_ERROR_MESSAGES.INVALID_USER_ID,
      }),
      { required_error: E2EE_ERROR_MESSAGES.BATCH_EMPTY },
    )
    .min(1, E2EE_ERROR_MESSAGES.BATCH_EMPTY)
    .max(MAX_BATCH_PUBLIC_KEYS, E2EE_ERROR_MESSAGES.BATCH_LIMIT_EXCEEDED),
});

export const targetUserParamSchema = z.object({
  id: z.string().refine((id) => isValidObjectId(id), {
    message: E2EE_ERROR_MESSAGES.INVALID_USER_ID,
  }),
});

export const registerDeviceSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
  publicKey: publicKeySchema,
  deviceName: z.string().trim().max(100).optional(),
});

export const deviceIdParamSchema = z.object({
  deviceId: z.string().trim().min(1).max(128),
});

export const batchDevicePublicKeysSchema = z.object({
  userIds: z
    .array(
      z.string().refine((id) => isValidObjectId(id), {
        message: E2EE_ERROR_MESSAGES.INVALID_USER_ID,
      }),
      { required_error: E2EE_ERROR_MESSAGES.BATCH_EMPTY },
    )
    .min(1, E2EE_ERROR_MESSAGES.BATCH_EMPTY)
    .max(MAX_BATCH_PUBLIC_KEYS, E2EE_ERROR_MESSAGES.BATCH_LIMIT_EXCEEDED),
});

