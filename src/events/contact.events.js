import { io, refreshPrivacy } from "../lib/socket.js";
import {
  CONTACT_ADDED,
  CONTACT_REMOVED,
  CONTACT_UPDATED,
  CONTACTS_BULK_ADDED,
} from "../constants/socket-events.constants.js";

/**
 * Synchronizes privacy settings for one or more user IDs across sockets.
 * Uses Promise.allSettled to handle partial failures gracefully without throwing.
 * @param {string|string[]} userIds
 * @returns {Promise<void>}
 */
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

/**
 * Emits contact:added event to the owner's private socket room.
 * @param {string} ownerId
 * @param {object} payload
 */
export const emitContactAdded = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACT_ADDED, payload);
};

/**
 * Emits contact:removed event to the owner's private socket room.
 * @param {string} ownerId
 * @param {object} payload
 */
export const emitContactRemoved = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACT_REMOVED, payload);
};

/**
 * Emits contact:updated event to the owner's private socket room.
 * @param {string} ownerId
 * @param {object} payload
 */
export const emitContactUpdated = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACT_UPDATED, payload);
};

/**
 * Emits contacts:bulk-added event to the owner's private socket room.
 * @param {string} ownerId
 * @param {object} payload
 */
export const emitContactsBulkAdded = (ownerId, payload) => {
  io.to(String(ownerId)).emit(CONTACTS_BULK_ADDED, payload);
};
