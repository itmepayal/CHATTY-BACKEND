import crypto from "crypto";
import jwt from "jsonwebtoken";
import { authenticator } from "otplib";
import bcrypt from "bcryptjs";
import {
  CHALLENGE_TTL,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_BYTES,
  BCRYPT_ROUNDS_RECOVERY,
} from "../constants/constants.js";

authenticator.options = {
  window: 1,
  digits: 6,
  step: 30,
};

function getEncKey() {
  const hex = process.env.TOTP_ENCRYPTION_KEY || "";
  if (!hex || hex.length !== 64) {
    throw new Error(
      "TOTP_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

export function encryptSecret(secret) {
  const key = getEncKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored) {
  const key = getEncKey();
  const [ivHex, tagHex, encHex] = stored.split(":");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex"),
  );
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

export function generateSecret() {
  return authenticator.generateSecret(20);
}

export function buildOtpUri(secret, email, issuer = "Chatty") {
  return authenticator.keyuri(email, issuer, secret);
}

export function verifyTotpToken(token, encryptedSec) {
  try {
    const secret = decryptSecret(encryptedSec);
    return authenticator.verify({ token, secret });
  } catch {
    return false;
  }
}

function getChallengeSecret() {
  const base =
    process.env.CHALLENGE_TOKEN_SECRET || process.env.ACCESS_TOKEN_SECRET;
  if (!base) {
    throw new Error(
      "ACCESS_TOKEN_SECRET (or CHALLENGE_TOKEN_SECRET) is not set.",
    );
  }
  return process.env.CHALLENGE_TOKEN_SECRET ? base : `${base}:2fa-challenge`;
}

export function signChallengeToken(user) {
  return jwt.sign(
    { id: String(user._id), twoFactorChallenge: true },
    getChallengeSecret(),
    { expiresIn: CHALLENGE_TTL },
  );
}

export function verifyChallengeToken(token) {
  const decoded = jwt.verify(token, getChallengeSecret());
  if (!decoded.twoFactorChallenge) {
    throw new Error("Not a 2FA challenge token");
  }
  return decoded;
}

export function hashRecoveryCode(rawCode) {
  const normalized = String(rawCode || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export async function generateRecoveryCodes() {
  const codes = [];
  const hashes = [];

  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = crypto
      .randomBytes(RECOVERY_CODE_BYTES)
      .toString("hex")
      .toUpperCase()
      .match(/.{1,5}/g)
      .join("-");
    const hash = hashRecoveryCode(raw);
    codes.push(raw);
    hashes.push(hash);
  }

  return { codes, hashes };
}

export async function consumeRecoveryCode(rawCode, hashList) {
  if (!rawCode || !Array.isArray(hashList) || hashList.length === 0) {
    return -1;
  }

  const normalized = String(rawCode)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!normalized) return -1;

  const shaHash = hashRecoveryCode(normalized);

  for (let i = 0; i < hashList.length; i++) {
    const stored = hashList[i];
    if (typeof stored !== "string") continue;

    // Check if stored hash is SHA-256 (64 hex characters)
    if (stored.length === 64 && /^[0-9a-f]{64}$/i.test(stored)) {
      if (
        crypto.timingSafeEqual(
          Buffer.from(shaHash, "utf8"),
          Buffer.from(stored.toLowerCase(), "utf8"),
        )
      ) {
        return i;
      }
    } else if (stored.startsWith("$2")) {
      // Backward compatibility for existing bcrypt hashes
      const rawFormatted = String(rawCode).toUpperCase().replace(/\s+/g, "");
      const withHyphens = normalized.match(/.{1,5}/g)?.join("-") || normalized;
      if (
        (await bcrypt.compare(rawFormatted, stored)) ||
        (await bcrypt.compare(normalized, stored)) ||
        (await bcrypt.compare(withHyphens, stored))
      ) {
        return i;
      }
    }
  }

  return -1;
}
