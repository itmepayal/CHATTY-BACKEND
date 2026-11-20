import { z } from "zod";

const ALLOWED_KEYS = new Set([
  "soundEnabled",
  "soundVolume",
  "desktopNotifications",
  "showPreview",
]);

export const updateNotificationSettingsSchema = z
  .object({
    soundEnabled: z
      .boolean({
        invalid_type_error: "soundEnabled must be a boolean",
      })
      .optional(),
    soundVolume: z
      .number({
        invalid_type_error: "soundVolume must be a number",
      })
      .int("soundVolume must be an integer")
      .min(0, "soundVolume must be at least 0")
      .max(100, "soundVolume must be at most 100")
      .optional(),
    desktopNotifications: z
      .boolean({
        invalid_type_error: "desktopNotifications must be a boolean",
      })
      .optional(),
    showPreview: z
      .boolean({
        invalid_type_error: "showPreview must be a boolean",
      })
      .optional(),
  })
  .strict("Unknown field(s) provided");

export const validateNotificationUpdateBody = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "Invalid request body." };
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return { valid: false, error: "Empty update object provided." };
  }

  const unknown = keys.filter((k) => !ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    return {
      valid: false,
      error: `Unknown field(s): ${unknown.join(", ")}`,
    };
  }

  const result = updateNotificationSettingsSchema.safeParse(body);
  if (!result.success) {
    const firstIssue = result.error.issues?.[0];
    return {
      valid: false,
      error: firstIssue?.message || "Invalid input data",
    };
  }

  return { valid: true, data: result.data };
};

export const updateNotificationPreferencesSchema = z
  .object({
    messagesPersonal: z.boolean().optional(),
    messagesGroup: z.boolean().optional(),
    messageReplies: z.boolean().optional(),
    messageMentions: z.boolean().optional(),
    messageReactions: z.boolean().optional(),
    mediaNotifications: z.boolean().optional(),
    callsVoice: z.boolean().optional(),
    callsVideo: z.boolean().optional(),
    callsMissed: z.boolean().optional(),
    callsGroup: z.boolean().optional(),
    contactRequests: z.boolean().optional(),
    contactAcceptance: z.boolean().optional(),
    groupInvitations: z.boolean().optional(),
    groupMembershipEvents: z.boolean().optional(),
    securityNewDevice: z.boolean().optional(),
    securityDeviceLinking: z.boolean().optional(),
    securityCredentialChanges: z.boolean().optional(),
    securityE2EEAlerts: z.boolean().optional(),
    systemAnnouncements: z.boolean().optional(),
    systemMaintenance: z.boolean().optional(),
    systemAlerts: z.boolean().optional(),
    dndEnabled: z.boolean().optional(),
    dndUntil: z.string().datetime().nullable().optional(),
  })
  .strict("Unknown preference field(s) provided");

export const validateNotificationPreferencesUpdateBody = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "Invalid request body." };
  }

  const result = updateNotificationPreferencesSchema.safeParse(body);
  if (!result.success) {
    const firstIssue = result.error.issues?.[0];
    return {
      valid: false,
      error: firstIssue?.message || "Invalid preference data",
    };
  }

  return { valid: true, data: result.data };
};

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url("Valid push endpoint URL is required"),
  keys: z.object({
    p256dh: z.string().min(1, "p256dh key is required"),
    auth: z.string().min(1, "auth key is required"),
  }),
  userAgent: z.string().optional(),
});

export const validatePushSubscriptionBody = (body) => {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Invalid request body." };
  }
  const result = pushSubscriptionSchema.safeParse(body);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues?.[0]?.message || "Invalid push subscription",
    };
  }
  return { valid: true, data: result.data };
};
