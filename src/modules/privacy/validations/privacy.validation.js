import { z } from "zod";
import { VALID_THEMES } from "../constants/privacy.constants.js";

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
    whoCanAddMeToGroups: z.enum(["everyone", "contacts", "nobody"]).optional(),
  })
  .passthrough();

export const updateChatPrefsBodySchema = z
  .object({
    enterToSend: z.boolean().optional(),
    largeEmoji: z.boolean().optional(),
    autoScroll: z.boolean().optional(),
    enterIsSend: z.boolean().optional(),
  })
  .passthrough();

export const updateAppearanceBodySchema = z
  .object({
    theme: z.enum(VALID_THEMES).optional(),
    fontSize: z.enum(["sm", "md", "lg", "small", "medium", "large"]).optional(),
    bubbleStyle: z.enum(["rounded", "soft", "sharp", "round"]).optional(),
    messageBubbleStyle: z.enum([
      "rounded",
      "soft",
      "sharp",
      "round",
      "modern",
      "classic",
      "minimal",
    ]).optional(),
    bubble: z.enum(["round", "soft", "sharp", "rounded"]).optional(),
    density: z.enum(["comfortable", "compact", "cozy"]).optional(),
    spacing: z.enum(["comfortable", "compact", "cozy"]).optional(),
    messageSpacing: z.enum(["comfortable", "compact", "cozy"]).optional(),
    compactMode: z.boolean().optional(),
    showTimestamps: z.boolean().optional(),
    timestamps: z.boolean().optional(),
    timeFormat: z.enum(["12h", "24h", "12-hour", "24-hour"]).optional(),
  })
  .passthrough();
