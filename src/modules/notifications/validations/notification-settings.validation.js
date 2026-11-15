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
