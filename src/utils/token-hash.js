import crypto from "crypto";

export const hashToken = (raw) =>
  crypto.createHash("sha256").update(raw).digest("hex");
