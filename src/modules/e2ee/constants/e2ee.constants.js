export const E2EE_ALGORITHM = "ECDH";
export const E2EE_NAMED_CURVE = "P-256";
export const E2EE_KEY_TYPE = "EC";

export const MAX_BACKUP_SIZE_BYTES = 65536;
export const MIN_BACKUP_SIZE_BYTES = 16;
export const MAX_BATCH_PUBLIC_KEYS = 100;
export const DEFAULT_BACKUP_VERSION = 1;

export const E2EE_RESET_CONFIRM_KEYWORD = "RESET_E2EE_IDENTITY";

export const E2EE_ERROR_MESSAGES = Object.freeze({
  KEY_ALREADY_EXISTS:
    "A cryptographic public key is already registered for this account.",
  KEY_NOT_FOUND: "This user has no encryption key yet.",
  BACKUP_NOT_FOUND: "No encrypted private key backup found for this account.",
  BACKUP_ALREADY_EXISTS: "An encrypted private key backup already exists.",
  PUBLIC_KEY_REQUIRED:
    "Cannot create or update a backup without a registered public key. Register your keys first.",
  INVALID_PUBLIC_KEY:
    "Invalid public key format. Expected ECDH P-256 JWK with kty='EC', crv='P-256', and non-empty x and y coordinates.",
  INVALID_BACKUP_DATA:
    "Invalid encrypted backup data. Must be a valid string or serialized ciphertext envelope.",
  BACKUP_SIZE_EXCEEDED: `Encrypted backup payload exceeds maximum allowable size of ${MAX_BACKUP_SIZE_BYTES} bytes.`,
  BACKUP_TOO_SHORT: `Encrypted backup payload must be at least ${MIN_BACKUP_SIZE_BYTES} bytes.`,
  PASSWORD_REQUIRED: "Account password is required to reset E2EE keys.",
  PASSWORD_INCORRECT: "Password is incorrect.",
  CONFIRMATION_REQUIRED: `Explicit confirmation is required. Field 'confirm' must equal '${E2EE_RESET_CONFIRM_KEYWORD}'.`,
  BATCH_EMPTY: "userIds array must contain at least one valid user ID.",
  BATCH_LIMIT_EXCEEDED: `Cannot query more than ${MAX_BATCH_PUBLIC_KEYS} public keys in a single request.`,
  INVALID_USER_ID: "Invalid user ID format.",
  USER_NOT_FOUND: "User not found.",
});
