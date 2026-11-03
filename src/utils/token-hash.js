import crypto from "crypto";

export const hashToken = (raw) =>
  crypto.createHash("sha256").update(raw).digest("hex");

export const isValidResetToken = (token) =>
  typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);
