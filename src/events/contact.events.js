import { io, refreshPrivacy } from "../lib/socket.js";
import {
  CONTACT_ADDED,
  CONTACT_REMOVED,
  CONTACT_UPDATED,
  CONTACTS_BULK_ADDED,
} from "../constants/socket-events.constants.js";

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
