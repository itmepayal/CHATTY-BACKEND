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
  })
  .refine(
    (val) => {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === "object") {
          // Reject unencrypted private key JWKs containing "d" parameter
          if ("d" in parsed && ("x" in parsed || "kty" in parsed)) {
            return false;
          }
        }
      } catch {
        // Plain string or base64 token
      }
      return true;
    },
    {
      message: "Plaintext private keys must never be transmitted or stored on the server.",
    },
  )
  .refine(
    (val) => {
      try {
        const parsed = JSON.parse(val);
        if (parsed && typeof parsed === "object" && parsed.version && parsed.algorithm) {
          if (!parsed.salt || !parsed.iv || !parsed.ciphertext) {
            return false;
          }
        }
      } catch {
        // Ignore parsing errors for non-JSON strings
      }
      return true;
    },
    {
      message: "Encrypted backup envelope is missing required cryptographic fields (salt, iv, ciphertext).",
    },
  );

export const registerKeysSchema = z.object({
  publicKey: publicKeySchema,
  encryptedPrivateKey: encryptedPrivateKeySchema,
  backupVersion: z.number().int().min(1).max(100).optional().default(1),
});

export const updateBackupSchema = z.object({
  encryptedPrivateKey: encryptedPrivateKeySchema,
  backupVersion: z.number().int().min(1).max(100).optional(),
  expectedVersion: z.number().int().min(1).max(100).optional(),
  deviceId: z.string().trim().min(1).max(128).optional(),
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
  deviceId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((id) => id !== "device-session-fallback", {
      message: "Static fallback device ID is not permitted.",
    }),
  publicKey: publicKeySchema,
  deviceName: z.string().trim().max(100).optional(),
});

export const deviceIdParamSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((id) => id !== "device-session-fallback", {
      message: "Static fallback device ID is not permitted.",
    }),
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

export const requestDeviceLinkSchema = z.object({
  ephemeralPublicKey: publicKeySchema,
  deviceId: z.string().trim().min(1).max(128),
  deviceName: z.string().trim().max(100).optional(),
});

export const approveDeviceLinkSchema = z.object({
  linkSessionId: z.string().trim().min(1).max(128).optional(),
  linkingPin: z.string().trim().min(1).max(20).optional(),
  encryptedPayload: z.object({
    ciphertext: z.string().min(1),
    iv: z.string().min(1),
    approverDeviceId: z.string().optional(),
  }).passthrough(),
  approverDeviceId: z.string().trim().min(1).max(128),
}).refine((data) => data.linkSessionId || data.linkingPin, {
  message: "Either linkSessionId or linkingPin is required to approve device link.",
});

export const linkSessionIdParamSchema = z.object({
  linkSessionId: z.string().trim().min(1).max(128),
});

export const linkingPinParamSchema = z.object({
  linkingPin: z.string().trim().min(1).max(20),
});

export const rotateDeviceSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .refine((id) => id !== "device-session-fallback", {
      message: "Static fallback device ID is not permitted.",
    }),
  newPublicKey: publicKeySchema,
  deviceName: z.string().trim().max(100).optional(),
});


