import { z } from "zod";

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
