export const CONTACT_ADDED = "contact:added";
export const CONTACT_REMOVED = "contact:removed";
export const CONTACT_UPDATED = "contact:updated";
export const CONTACTS_BULK_ADDED = "contacts:bulk-added";

export const SOCKET_CONTACT_EVENTS = Object.freeze({
  CONTACT_ADDED,
  CONTACT_REMOVED,
  CONTACT_UPDATED,
  CONTACTS_BULK_ADDED,
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

  CONVERSATION_UPDATED: "conversationUpdated",
  DISAPPEARING_UPDATED: "disappearingUpdated",
  CHAT_ARCHIVED: "chatArchived",

  LOCATION_UPDATE: "location:update",
  LOCATION_ENDED: "location:ended",
});
