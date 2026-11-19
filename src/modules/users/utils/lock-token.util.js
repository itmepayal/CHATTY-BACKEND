import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcryptjs";

const LOCK_TOKEN_SECRET =
  process.env.LOCK_TOKEN_SECRET ||
  process.env.ACCESS_TOKEN_SECRET ||
  "chatty_lock_token_secret_default_key";

export const UNLOCK_TOKEN_EXPIRY_SECONDS = 600;

export const generateUnlockToken = ({
  userId,
  sessionId = null,
  scope = "app",
  lockEpoch = 0,
}) => {
  return jwt.sign(
    {
      userId: String(userId),
      sessionId: sessionId ? String(sessionId) : null,
      scope: String(scope),
      lockEpoch: Number(lockEpoch) || 0,
    },
    LOCK_TOKEN_SECRET,
    { expiresIn: `${UNLOCK_TOKEN_EXPIRY_SECONDS}s` },
  );
};

/**
 * Verifies and decodes an unlock token.
 */
export const verifyUnlockToken = (token) => {
  if (!token || typeof token !== "string") return null;
  try {
    return jwt.verify(token, LOCK_TOKEN_SECRET);
  } catch {
    return null;
  }
};

/**
 * Checks whether an unlock token is valid for a given user, session, scope and lockEpoch.
 */
export const isUnlockTokenValid = (
  token,
  expectedUserId,
  expectedSessionId = null,
  expectedScope = "app",
  currentLockEpoch = 0,
) => {
  const decoded = verifyUnlockToken(token);
  if (!decoded) return false;
  if (expectedUserId && String(decoded.userId) !== String(expectedUserId))
    return false;
  if (
    decoded.scope !== "app" &&
    expectedScope &&
    decoded.scope !== expectedScope &&
    String(decoded.scope) !== String(expectedScope)
  )
    return false;
  if (
    decoded.lockEpoch !== undefined &&
    Number(decoded.lockEpoch) < Number(currentLockEpoch || 0)
  )
    return false;
  if (
    decoded.sessionId &&
    expectedSessionId &&
    String(decoded.sessionId) !== String(expectedSessionId)
  )
    return false;
  return true;
};

/**
 * Constant-time PIN verification supporting bcrypt and PBKDF2 formats.
 */
export const verifyPinHash = async (pin, storedHash) => {
  if (
    !pin ||
    !storedHash ||
    typeof pin !== "string" ||
    typeof storedHash !== "string"
  ) {
    return false;
  }

  // 1. Standard bcrypt hash
  if (
    storedHash.startsWith("$2a$") ||
    storedHash.startsWith("$2b$") ||
    storedHash.startsWith("$2y$")
  ) {
    return await bcrypt.compare(pin, storedHash);
  }

  // 2. PBKDF2 format: pbkdf2:iterations:salt:hash or pbkdf2$iterations$salt$hash
  const colonParts = storedHash.split(":");
  const dollarParts = storedHash.split("$");

  if (colonParts.length === 4 && colonParts[0] === "pbkdf2") {
    const iterations = parseInt(colonParts[1], 10) || 100000;
    const salt = colonParts[2];
    const targetHash = colonParts[3];
    const derived = crypto
      .pbkdf2Sync(pin, Buffer.from(salt, "hex"), iterations, 32, "sha256")
      .toString("hex");
    return (
      derived.length === targetHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(derived, "utf8"),
        Buffer.from(targetHash, "utf8"),
      )
    );
  }

  if (
    dollarParts.length >= 4 &&
    dollarParts[0].toLowerCase().includes("pbkdf2")
  ) {
    const iterations = parseInt(dollarParts[1], 10) || 100000;
    const salt = dollarParts[2];
    const targetHash = dollarParts[3];
    const derived = crypto
      .pbkdf2Sync(pin, salt, iterations, 32, "sha256")
      .toString("hex");
    const targetBuf = Buffer.from(targetHash, "utf8");
    const derivedBuf = Buffer.from(derived, "utf8");
    return (
      derivedBuf.length === targetBuf.length &&
      crypto.timingSafeEqual(derivedBuf, targetBuf)
    );
  }

  // 3. Fallback: v2:local:salt:hash or salt:hash
  if (colonParts.length === 4 && colonParts[0] === "v2") {
    const salt = colonParts[2];
    const targetHash = colonParts[3];
    const hash = crypto
      .createHash("sha256")
      .update(`${salt}:${pin}`)
      .digest("hex");
    return (
      hash.length === targetHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(hash, "utf8"),
        Buffer.from(targetHash, "utf8"),
      )
    );
  }

  if (colonParts.length === 2) {
    const [salt, targetHash] = colonParts;
    const hash = crypto
      .createHash("sha256")
      .update(`${salt}:${pin}`)
      .digest("hex");
    return (
      hash.length === targetHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(hash, "utf8"),
        Buffer.from(targetHash, "utf8"),
      )
    );
  }

  // Fallback direct bcrypt compare if unrecognized format
  try {
    return await bcrypt.compare(pin, storedHash);
  } catch {
    return false;
  }
};

/**
 * Creates a slow bcrypt hash for a 4-digit PIN.
 */
export const hashPin = async (pin) => {
  return await bcrypt.hash(pin, 10);
};
