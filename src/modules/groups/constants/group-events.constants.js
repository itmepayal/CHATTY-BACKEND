/**
 * Group Socket Event Constants
 * Centralizes all realtime event identifiers emitted and listened for groups.
 */

export const GROUP_SOCKET_EVENTS = Object.freeze({
  GROUP_CREATED: "group:created",
  GROUP_UPDATED: "group:updated",
  GROUP_DELETED: "group:deleted",
  GROUP_REMOVED: "group:removed",
  GROUP_MEMBER_ADDED: "group:memberAdded",
  GROUP_MEMBER_REMOVED: "group:memberRemoved",
  GROUP_ROLE_CHANGED: "group:roleChanged",
  GROUP_LEFT: "group:left",
  GROUP_NEW_MESSAGE: "group:newMessage",
  GROUP_MESSAGE_EDITED: "group:messageEdited",
  GROUP_MESSAGE_DELETED: "group:messageDeleted",
  GROUP_MESSAGES_SEEN: "group:messagesSeen",
  GROUP_CONVERSATION_UPDATED: "group:conversationUpdated",
  GROUP_KEY_ROTATION_REQUIRED: "group:keyRotationRequired",
  GROUP_KEYS_NEEDED: "group:keysNeeded",
  GROUP_KEYS_UPDATED: "group:keysUpdated",
  GROUP_LOCATION_UPDATE: "group:location:update",
  GROUP_LOCATION_ENDED: "group:location:ended",
  GROUP_ARCHIVE_CHANGED: "group:archiveChanged",
  GROUP_TYPING: "group:typing",
});
