/**
 * Group Module Constants
 * Defines limits, roles, error messages, and success messages for group operations.
 */

export const GROUP_ROLES = Object.freeze({
  ADMIN: "admin",
  MEMBER: "member",
});

export const MAX_GROUP_MEMBERS = 256;
export const GROUP_NAME_MIN = 2;
export const GROUP_NAME_MAX = 50;

export const MAX_GROUP_TEXT = 2000;
export const MAX_TEXT_LENGTH = 2000;
export const MAX_CIPHERTEXT_LENGTH = 24000;

export const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export const MIN_LOCATION_UPDATE_INTERVAL_MS = 2000;
export const LIVE_DURATIONS_MIN = Object.freeze([15, 60, 480]);

export const MAX_AUDIO_DURATION_SEC = 300;
export const MAX_VIDEO_DURATION_SEC = 60;

export const GROUP_SUCCESS_MESSAGES = Object.freeze({
  GROUP_CREATED: "Group created.",
  GROUPS_FETCHED: "Groups fetched.",
  GROUP_FETCHED: "Group fetched.",
  GROUP_UPDATED: "Group updated.",
  GROUP_DELETED: "Group deleted.",
  MEMBERS_ADDED: "Members added.",
  MEMBER_REMOVED: "Member removed.",
  ROLE_CHANGED: "Member role updated.",
  LEFT_GROUP: "You left the group.",
  LEFT_AND_DELETED: "You left. The group was deleted.",
  ARCHIVED: "Group archived.",
  UNARCHIVED: "Group unarchived.",
  KEYS_FETCHED: "Group keys fetched.",
  KEYS_UPDATED: "Group keys updated.",
  PENDING_KEY_MEMBERS: "Pending key members fetched.",
  GROUP_NOT_ENCRYPTED: "Group is not encrypted.",
  MESSAGE_SENT: "Message sent.",
  MESSAGE_ALREADY_SENT: "Message already sent.",
  MESSAGE_EDITED: "Group message edited successfully.",
  MESSAGE_NO_CHANGES: "No changes.",
  MESSAGE_DELETED: "Group message deleted successfully.",
  MESSAGES_FETCHED: "Group messages fetched.",
  MESSAGES_SEEN: "Messages marked as seen.",
  LOCATION_SENT: "Location sent.",
  LOCATION_ALREADY_SENT: "Location already sent.",
  LIVE_LOCATION_STARTED: "Live location started.",
  LIVE_LOCATION_ALREADY_STARTED: "Live location already started.",
  LOCATION_UPDATED: "Location updated.",
  LOCATION_UPDATE_SKIPPED: "Update skipped (too frequent).",
  LIVE_LOCATION_STOPPED: "Live location stopped.",
  ACTIVE_SHARES_FETCHED: "Active location shares.",
});

export const GROUP_ERROR_MESSAGES = Object.freeze({
  INVALID_GROUP_ID: "Invalid group ID.",
  INVALID_USER_ID: "Invalid user ID.",
  INVALID_MESSAGE_ID: "Invalid message ID.",
  INVALID_SHARE_ID: "Invalid share ID.",
  GROUP_NOT_FOUND: "Group not found.",
  NOT_A_MEMBER: "You are not a member of this group.",
  ADMIN_ONLY: "Only group admins can do this.",
  OWNER_ONLY: "Only the group owner can delete the group.",
  CANNOT_REMOVE_OWNER: "The group owner can't be removed.",
  CANNOT_CHANGE_OWNER_ROLE: "The owner's role can't be changed.",
  CANNOT_CHANGE_OWN_ROLE: "You can't change your own role.",
  CANNOT_REMOVE_SELF: "Use 'leave group' to remove yourself.",
  ONLY_OWNER_DEMOTE_ADMIN: "Only the owner can demote an admin.",
  ONLY_OWNER_REMOVE_ADMIN: "Only the owner can remove an admin.",
  CANNOT_DEMOTE_LAST_ADMIN: "Cannot demote the only remaining admin.",
  USER_NOT_IN_GROUP: "User is not in this group.",
  NO_NEW_MEMBERS: "No new members to add.",
  EXCEEDED_MEMBER_LIMIT: `A group can have at most ${MAX_GROUP_MEMBERS} members.`,
  USERS_NOT_FOUND: "One or more users were not found.",
  CANNOT_ADD_BLOCKED: "You can't add one or more of these users.",
  USER_SUSPENDED: "One or more selected users are suspended or inactive.",
  MESSAGE_NOT_FOUND: "Message not found.",
  EDIT_FORBIDDEN: "Only the sender can edit this message.",
  DELETE_FORBIDDEN: "You do not have permission to delete this message.",
  EDIT_ONLY_TEXT: "Only text messages can be edited.",
  EDIT_TIME_OVER: "Edit time is over.",
  CANNOT_CHANGE_ENCRYPTION: "Encryption mode of a message can't be changed.",
  INVALID_CIPHERTEXT: "Invalid ciphertext or IV.",
  KEYS_ONLY_FOR_MEMBERS: "Keys can only be created for group members.",
  INVALID_KEY_VERSION: "Invalid key version.",
  KEY_VERSION_MUST_BE_SEQUENTIAL: "Key version must be sequential.",
  KEY_VERSION_INCLUDE_ALL: "A new key version must include every member.",
  KEY_ROTATION_CONFLICT: "Key was rotated by someone else. Fetch the new key.",
  KEY_PUBLISH_FORBIDDEN: "You do not have permission to publish keys.",
  LIVE_SHARE_NOT_FOUND: "Live share not found.",
  LIVE_SHARE_EXPIRED: "Live share has expired.",
  SHARE_MANAGE_FORBIDDEN: "You do not have permission to manage this live share.",
  INVALID_LOCATION: "Invalid location.",
  NO_CHANGES_TO_UPDATE: "No changes to update.",
  INVALID_ROLE: "Role must be 'admin' or 'member'.",
  EMPTY_MESSAGE: "Message must have text, an attachment or a location.",
  INVALID_NAME: `Group name must be between ${GROUP_NAME_MIN} and ${GROUP_NAME_MAX} characters.`,
  INVALID_PAGINATION: "Invalid pagination parameters.",
});
