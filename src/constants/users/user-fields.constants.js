/**
 * User Field Selection & Profile Constants
 * Centralizes projection strings and profile constraints used across contact,
 * chat list, search, and user profile operations.
 */

export const PUBLIC_USER_FIELDS =
  "fullName username avatar bio profilePhotoVisibility aboutVisibility status";

export const CONTACT_POPULATE_FIELDS =
  "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility status";

export const SEARCH_USER_FIELDS =
  "fullName username avatar bio profilePhotoVisibility aboutVisibility";

export const CHAT_LIST_USER_FIELDS =
  "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility";

export const USER_PROFILE = Object.freeze({
  FULL_NAME_MIN: 2,
  FULL_NAME_MAX: 50,
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  BIO_MAX: 160,
  LOCATION_MAX: 60,
  PHONE_REGEX: /^[+\d][\d\s-]{7,15}$/,
  USERNAME_REGEX: /^[a-z0-9_.]{3,20}$/,
  WEBSITE_REGEX: /^https?:\/\/.+\..+/,
});

export const GENDERS = Object.freeze([
  "Female",
  "Male",
  "Other",
  "Prefer not to say",
  "",
]);
