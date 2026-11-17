import { z } from "zod";
import {
  VIS,
  ONLINE_VIS,
  STATUS_VIS,
  VALID_THEMES,
} from "../constants/privacy.constants.js";

export const updatePrivacyBodySchema = z
  .object({
    showOnlineStatus: z.boolean().optional(),
    readReceipts: z.boolean().optional(),
    typingIndicator: z.boolean().optional(),
    silenceUnknownCallers: z.boolean().optional(),
    appLockEnabled: z.boolean().optional(),
    appLockTimeout: z.enum(["immediately", "1m", "5m", "15m", "1h"]).optional(),
    appLockPinHash: z.string().nullable().optional(),
    lastSeenVisibility: z.enum(VIS).optional(),
    onlineStatusVisibility: z.enum(ONLINE_VIS).optional(),
    profilePhotoVisibility: z.enum(VIS).optional(),
    aboutVisibility: z.enum(VIS).optional(),
    statusVisibility: z.enum(STATUS_VIS).optional(),
    groupAddPermission: z.enum(VIS).optional(),
    whoCanAddMeToGroups: z.enum(VIS).optional(),
    lastSeenExceptions: z.array(z.string()).optional(),
    profilePhotoExceptions: z.array(z.string()).optional(),
    aboutExceptions: z.array(z.string()).optional(),
    statusExceptions: z.array(z.string()).optional(),
    statusIncluded: z.array(z.string()).optional(),
    groupAddExceptions: z.array(z.string()).optional(),
    lockedChats: z.array(z.string()).optional(),
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
    messageBubbleStyle: z
      .enum([
        "rounded",
        "soft",
        "sharp",
        "round",
        "modern",
        "classic",
        "minimal",
      ])
      .optional(),
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
