import { z } from "zod";
import { objectIdSchema } from "./common.validation.js";

export const userIdParamSchema = z.object({
  id: objectIdSchema,
});

export const updateProfileBodySchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name cannot be empty.").optional(),
    username: z.string().trim().optional(),
    bio: z.string().max(250, "Bio cannot exceed 250 characters.").optional(),
    gender: z.string().optional(),
    dob: z.string().optional(),
  })
  .passthrough();

export const updatePrivacyBodySchema = z
  .object({
    showOnlineStatus: z.boolean().optional(),
    readReceipts: z.boolean().optional(),
    typingIndicator: z.boolean().optional(),
    lastSeenVisibility: z.enum(["everyone", "contacts", "nobody"]).optional(),
    onlineStatusVisibility: z.enum(["everyone", "contacts", "nobody"]).optional(),
    profilePhotoVisibility: z.enum(["everyone", "contacts", "nobody"]).optional(),
    aboutVisibility: z.enum(["everyone", "contacts", "nobody"]).optional(),
    groupAddPermission: z.enum(["everyone", "contacts", "nobody"]).optional(),
  })
  .passthrough();

export const updateChatPrefsBodySchema = z
  .object({
    enterIsSend: z.boolean().optional(),
    mediaAutoDownload: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    fontSize: z.enum(["small", "medium", "large"]).optional(),
  })
  .passthrough();

export const updateAppearanceBodySchema = z
  .object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    accentColor: z.string().optional(),
  })
  .passthrough();

export const publicKeyBodySchema = z.object({
  publicKey: z.string({ required_error: "Public key is required." }).min(1, "Public key is required."),
});
