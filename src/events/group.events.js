import { io, groupRoom } from "../lib/socket.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";

/**
 * Adds a user's active sockets to a group room.
 * @param {string} userId
 * @param {string} groupId
 */
export const joinGroupRoom = (userId, groupId) => {
  io.in(String(userId)).socketsJoin(groupRoom(groupId));
};

/**
 * Removes a user's active sockets from a group room.
 * @param {string} userId
 * @param {string} groupId
 */
export const leaveGroupRoom = (userId, groupId) => {
  io.in(String(userId)).socketsLeave(groupRoom(groupId));
};

/**
 * Evicts all connected sockets from a group room (used upon group deletion).
 * @param {string} groupId
 */
export const evictAllFromGroupRoom = (groupId) => {
  io.in(groupRoom(groupId)).socketsLeave(groupRoom(groupId));
};

/**
 * Emits an event to each member's personal user room.
 * @param {Object} group
 * @param {string} event
 * @param {any} payload
 * @param {string[]} [exceptIds=[]]
 */
export const emitToGroupMembers = (group, event, payload, exceptIds = []) => {
  const skip = new Set(exceptIds.map(String));
  for (const m of group.members) {
    const id = String(m.userId?._id || m.userId);
    if (!skip.has(id)) {
      io.to(id).emit(event, payload);
    }
  }
};

/**
 * Emits an event directly to the group socket room.
 * @param {string} groupId
 * @param {string} event
 * @param {any} payload
 */
export const emitToGroupRoom = (groupId, event, payload) => {
  io.to(groupRoom(groupId)).emit(event, payload);
};

/**
 * Emits an event directly to a single user's personal room.
 * @param {string} userId
 * @param {string} event
 * @param {any} payload
 */
export const emitToUser = (userId, event, payload) => {
  io.to(String(userId)).emit(event, payload);
};

/**
 * Broadcasts message edit events to both active room subscribers and personal member rooms.
 * Dual emission ensures clients actively viewing the conversation receive immediate DOM updates,
 * while background/other-tab clients receive conversation list previews without subscribing to all rooms.
 * @param {Object} group
 * @param {Object} payload
 */
export const broadcastGroupMessageEdited = (group, payload) => {
  io.to(groupRoom(group._id)).emit(
    GROUP_SOCKET_EVENTS.GROUP_MESSAGE_EDITED,
    payload,
  );
  emitToGroupMembers(group, GROUP_SOCKET_EVENTS.GROUP_MESSAGE_EDITED, payload);
};

/**
 * Broadcasts message deletion events to both active room subscribers and personal member rooms.
 * Dual emission ensures actively focused viewports wipe message bubbles immediately,
 * while inactive client tabs update unread counters and conversation snippets.
 * @param {Object} group
 * @param {Object} payload
 */
export const broadcastGroupMessageDeleted = (group, payload) => {
  io.to(groupRoom(group._id)).emit(
    GROUP_SOCKET_EVENTS.GROUP_MESSAGE_DELETED,
    payload,
  );
  emitToGroupMembers(group, GROUP_SOCKET_EVENTS.GROUP_MESSAGE_DELETED, payload);
};

/**
 * Broadcasts group deletion and evicts all remaining sockets from the group room.
 * @param {Object} group
 * @param {Object} payload
 */
export const broadcastGroupDeleted = (group, payload) => {
  emitToGroupMembers(group, GROUP_SOCKET_EVENTS.GROUP_DELETED, payload);
  evictAllFromGroupRoom(group._id);
};

/**
 * Emits a removal/leave notification directly to a single removed user.
 * @param {string} userId
 * @param {Object} payload
 */
export const broadcastGroupRemoved = (userId, payload) => {
  io.to(String(userId)).emit(GROUP_SOCKET_EVENTS.GROUP_REMOVED, payload);
};

/**
 * Emits archive state change to a user's personal room.
 * @param {string} userId
 * @param {Object} payload
 */
export const broadcastGroupArchiveChanged = (userId, payload) => {
  io.to(String(userId)).emit(
    GROUP_SOCKET_EVENTS.GROUP_ARCHIVE_CHANGED,
    payload,
  );
};

/**
 * Notifies affected members that new encryption keys are available.
 * @param {string[]} userIds
 * @param {Object} payload
 */
export const broadcastGroupKeysUpdated = (userIds, payload) => {
  userIds.forEach((uid) =>
    io.to(String(uid)).emit(GROUP_SOCKET_EVENTS.GROUP_KEYS_UPDATED, payload),
  );
};

/**
 * Emits key rotation requirement to targeted user IDs (e.g. admins) or all group members.
 * @param {string[]|Object} targets - Array of user IDs or a group object
 * @param {Object} payload
 */
export const broadcastGroupKeyRotationRequired = (targets, payload) => {
  if (Array.isArray(targets)) {
    targets.forEach((uid) =>
      io.to(String(uid)).emit(
        GROUP_SOCKET_EVENTS.GROUP_KEY_ROTATION_REQUIRED,
        payload,
      ),
    );
  } else if (targets?.members) {
    emitToGroupMembers(
      targets,
      GROUP_SOCKET_EVENTS.GROUP_KEY_ROTATION_REQUIRED,
      payload,
    );
  }
};

/**
 * Emits a request for encryption keys to specific newly added members.
 * @param {string[]} userIds
 * @param {Object} payload
 */
export const broadcastGroupKeysNeeded = (userIds, payload) => {
  userIds.forEach((uid) =>
    io.to(String(uid)).emit(GROUP_SOCKET_EVENTS.GROUP_KEYS_NEEDED, payload),
  );
};

/**
 * Emits a single conversation card update to a user's personal room.
 * @param {string} userId
 * @param {Object} payload
 */
export const emitGroupConversationUpdate = (userId, payload) => {
  io.to(String(userId)).emit(
    GROUP_SOCKET_EVENTS.GROUP_CONVERSATION_UPDATED,
    payload,
  );
};

/**
 * Emits live location updates to authorized group viewers who haven't blocked the sharer.
 * @param {Object} group
 * @param {string} sharerId
 * @param {string} event
 * @param {Object} payload
 * @param {Set<string>} blockedMe
 */
export const emitToViewers = async (
  group,
  sharerId,
  event,
  payload,
  blockedMe = new Set(),
) => {
  for (const m of group.members) {
    const uid = String(m.userId?._id || m.userId);
    if (uid !== String(sharerId) && !blockedMe.has(uid)) {
      io.to(uid).emit(event, payload);
    }
  }
};
