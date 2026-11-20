import { io, refreshPrivacy } from "../../../infrastructure/socket/socket.js";
import {
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
} from "../../../shared/constants/socket-events.constants.js";

export const syncPrivacy = async (userIds) => {
  const ids = Array.isArray(userIds) ? userIds : [userIds];
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];

  const results = await Promise.allSettled(
    uniqueIds.map((id) => refreshPrivacy(id)),
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      console.error(
        `[contact.events] refreshPrivacy failed for user ${uniqueIds[i]}:`,
        results[i].reason?.message || results[i].reason,
      );
    }
  }
};

export const emitContactAdded = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACT_ADDED, payload);
};

export const emitContactRemoved = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACT_REMOVED, payload);
};

export const emitContactUpdated = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACT_UPDATED, payload);
};

export const emitContactsBulkAdded = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACTS_BULK_ADDED, payload);
};

export const emitContactRequestReceived = (recipientId, payload) => {
  io.to(String(recipientId)).emit(CONTACT_REQUEST_RECEIVED, payload);
};

export const emitContactRequestAccepted = (senderId, payload) => {
  io.to(String(senderId)).emit(CONTACT_REQUEST_ACCEPTED, payload);
};

export const emitContactRequestRejected = (senderId, payload) => {
  io.to(String(senderId)).emit(CONTACT_REQUEST_REJECTED, payload);
};

export const emitContactRequestSent = (senderId, payload) => {
  io.to(String(senderId)).emit(CONTACT_REQUEST_SENT, payload);
};

export const emitContactRequestCancelled = (recipientId, payload) => {
  io.to(String(recipientId)).emit(CONTACT_REQUEST_CANCELLED, payload);
};

export const emitContactBlocked = (userId, payload) => {
  io.to(String(userId)).emit(CONTACT_BLOCKED, payload);
};

export const emitContactUnblocked = (userId, payload) => {
  io.to(String(userId)).emit(CONTACT_UNBLOCKED, payload);
};
