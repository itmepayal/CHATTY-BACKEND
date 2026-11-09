/**
 * User Field Selection Constants
 * Centralizes projection strings used across contact queries and populates.
 */

export const PUBLIC_USER_FIELDS =
  "fullName username avatar bio profilePhotoVisibility aboutVisibility status";

export const CONTACT_POPULATE_FIELDS =
  "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility status";

export const SEARCH_USER_FIELDS =
  "fullName username avatar bio profilePhotoVisibility aboutVisibility";

export const CHAT_LIST_USER_FIELDS =
  "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility";
