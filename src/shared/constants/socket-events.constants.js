export const CONTACT_ADDED = "contact:added";
export const CONTACT_REMOVED = "contact:removed";
export const CONTACT_UPDATED = "contact:updated";
export const CONTACTS_BULK_ADDED = "contacts:bulk-added";
export const CONTACT_REQUEST_RECEIVED = "contact:request:received";
export const CONTACT_REQUEST_SENT = "contact:request:sent";
export const CONTACT_REQUEST_ACCEPTED = "contact:request:accepted";
export const CONTACT_REQUEST_REJECTED = "contact:request:rejected";
export const CONTACT_REQUEST_CANCELLED = "contact:request:cancelled";
export const CONTACT_BLOCKED = "contact:blocked";
export const CONTACT_UNBLOCKED = "contact:unblocked";

export const NOTIFICATION_NEW = "notification:new";
export const NOTIFICATION_READ = "notification:read";
export const NOTIFICATION_COUNT_UPDATED = "notification:count:updated";

export const SOCKET_CONTACT_EVENTS = Object.freeze({
  CONTACT_ADDED,
  CONTACT_REMOVED,
  CONTACT_UPDATED,
  CONTACTS_BULK_ADDED,
  CONTACT_REQUEST_RECEIVED,
  CONTACT_REQUEST_SENT,
  CONTACT_REQUEST_ACCEPTED,
  CONTACT_REQUEST_REJECTED,
  CONTACT_REQUEST_CANCELLED,
  CONTACT_BLOCKED,
  CONTACT_UNBLOCKED,
});

export const SOCKET_EVENTS = Object.freeze({
  GET_ONLINE_USERS: "getOnlineUsers",

  CHAT_OPEN: "chat:open",
  CHAT_CLOSE: "chat:close",

  PRIVACY_UPDATE: "privacy:update",

  TYPING: "typing",

  NEW_MESSAGE: "newMessage",
  MESSAGES_DELIVERED: "messagesDelivered",
  MESSAGES_SEEN: "messagesSeen",
  MESSAGE_EDITED: "messageEdited",
  MESSAGE_DELETED: "messageDeleted",
  MESSAGE_DELETED_FOR_ME: "messageDeletedForMe",
  MESSAGE_PINNED: "messagePinned",
  MESSAGE_STARRED: "messageStarred",
  CHAT_PINNED: "chatPinned",
  CHAT_MUTED: "chatMuted",

  CONVERSATION_UPDATED: "conversationUpdated",
  DISAPPEARING_UPDATED: "disappearingUpdated",
  CHAT_ARCHIVED: "chatArchived",

  LOCATION_UPDATE: "location:update",
  LOCATION_ENDED: "location:ended",
});
