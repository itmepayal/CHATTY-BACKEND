/**
 * Contact Module Constants
 * Defines limits, statuses, and centralized error and success messages.
 */

export const MAX_NICKNAME_LENGTH = 50;
export const MAX_BULK_CONTACTS = 100;
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_RESULT_LIMIT = 20;

export const USER_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
});

export const CONTACT_ERROR_MESSAGES = Object.freeze({
  INVALID_USER_ID: "Invalid user ID.",
  CANNOT_ADD_SELF: "You can't add yourself.",
  USER_NOT_FOUND: "User not found.",
  CANNOT_ADD_BLOCKED: "Cannot add this user as a contact.",
  CONTACT_NOT_FOUND: "Contact not found.",
  INVALID_BULK_ARRAY: "contactIds must be a non-empty array.",
  EXCEEDED_BULK_LIMIT: `Cannot add more than ${MAX_BULK_CONTACTS} contacts at once.`,
  INVALID_NICKNAME: `Nickname cannot exceed ${MAX_NICKNAME_LENGTH} characters.`,
  SEARCH_MIN_LENGTH: `Type at least ${SEARCH_MIN_LENGTH} characters.`,
  OWNER_REQUIRED: "Owner ID is required.",
});

export const CONTACT_SUCCESS_MESSAGES = Object.freeze({
  CONTACT_ADDED: "Contact added.",
  CONTACT_REMOVED: "Contact removed.",
  CONTACT_FETCHED: "Contact fetched successfully.",
  CONTACTS_FETCHED: "Contacts fetched successfully.",
  NICKNAME_UPDATED: "Contact nickname updated.",
  MUTUAL_FETCHED: "Mutual contacts fetched successfully.",
  COUNT_FETCHED: "Contact count fetched successfully.",
  BULK_PROCESSED: "Bulk contacts processed.",
  CHAT_LIST_FETCHED: "Chat list fetched successfully.",
  USERS_FETCHED: "Users fetched successfully.",
});
