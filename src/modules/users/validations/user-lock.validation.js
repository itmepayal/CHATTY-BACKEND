import { z } from "zod";

export const verifyLockPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits."),
  chatId: z.string().optional(),
  scope: z.string().optional(),
});

export const setupLockPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits."),
  timeout: z.enum(["immediately", "1m", "5m", "15m", "1h"]).optional(),
});

export const disableLockPinSchema = z
  .object({
    pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits.").optional(),
    password: z.string().optional(),
    unlockToken: z.string().optional(),
  })
  .refine(
    (data) => Boolean(data.pin || data.password || data.unlockToken),
    { message: "Either pin, password, or unlockToken must be provided." },
  );
