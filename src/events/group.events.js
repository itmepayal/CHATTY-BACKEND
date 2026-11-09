import { io, groupRoom } from "../lib/socket.js";
import { GROUP_SOCKET_EVENTS } from "../constants/group-events.constants.js";

export const joinGroupRoom = (userId, groupId) => {
  io.in(String(userId)).socketsJoin(groupRoom(groupId));
};

export const leaveGroupRoom = (userId, groupId) => {
  io.in(String(userId)).socketsLeave(groupRoom(groupId));
};

export const evictAllFromGroupRoom = (groupId) => {
  io.in(groupRoom(groupId)).socketsLeave(groupRoom(groupId));
};

export const emitToGroupMembers = (group, event, payload, exceptIds = []) => {
  const skip = new Set(exceptIds.map(String));
  for (const m of group.members) {
    const id = String(m.userId?._id || m.userId);
    if (!skip.has(id)) {
      io.to(id).emit(event, payload);
    }
  }
};

export const emitToGroupRoom = (groupId, event, payload) => {
  io.to(groupRoom(groupId)).emit(event, payload);
};

export const emitToUser = (userId, event, payload) => {
  io.to(String(userId)).emit(event, payload);
};

export const broadcastGroupMessageEdited = (group, payload) => {
  io.to(groupRoom(group._id)).emit(
    GROUP_SOCKET_EVENTS.GROUP_MESSAGE_EDITED,
    payload,
  );
};

export const broadcastGroupMessageDeleted = (group, payload) => {
  io.to(groupRoom(group._id)).emit(
    GROUP_SOCKET_EVENTS.GROUP_MESSAGE_DELETED,
    payload,
  );
};

export const broadcastGroupDeleted = (group, payload) => {
  emitToGroupMembers(group, GROUP_SOCKET_EVENTS.GROUP_DELETED, payload);
  evictAllFromGroupRoom(group._id);
};

export const broadcastGroupRemoved = (userId, payload) => {
  io.to(String(userId)).emit(GROUP_SOCKET_EVENTS.GROUP_REMOVED, payload);
};

export const broadcastGroupArchiveChanged = (userId, payload) => {
  io.to(String(userId)).emit(
    GROUP_SOCKET_EVENTS.GROUP_ARCHIVE_CHANGED,
    payload,
  );
};

export const broadcastGroupKeysUpdated = (userIds, payload) => {
  userIds.forEach((uid) =>
    io.to(String(uid)).emit(GROUP_SOCKET_EVENTS.GROUP_KEYS_UPDATED, payload),
  );
};

export const broadcastGroupKeyRotationRequired = (targets, payload) => {
  if (Array.isArray(targets)) {
    targets.forEach((uid) =>
      io
        .to(String(uid))
        .emit(GROUP_SOCKET_EVENTS.GROUP_KEY_ROTATION_REQUIRED, payload),
    );
  } else if (targets?.members) {
    emitToGroupMembers(
      targets,
      GROUP_SOCKET_EVENTS.GROUP_KEY_ROTATION_REQUIRED,
      payload,
    );
  }
};

export const broadcastGroupKeysNeeded = (userIds, payload) => {
  userIds.forEach((uid) =>
    io.to(String(uid)).emit(GROUP_SOCKET_EVENTS.GROUP_KEYS_NEEDED, payload),
  );
};

export const emitGroupConversationUpdate = (userId, payload) => {
  io.to(String(userId)).emit(
    GROUP_SOCKET_EVENTS.GROUP_CONVERSATION_UPDATED,
    payload,
  );
};

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
