/**
 * Call Module Constants
 * Defines statuses, lifecycle states, types, socket events, limits, and error messages
 * for One-to-One and Group Audio/Video calling.
 */

export const CALL_STATUS = Object.freeze({
  MISSED: "missed",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  BUSY: "busy",
});

export const CALL_LIFECYCLE_STATE = Object.freeze({
  IDLE: "idle",
  INITIATING: "initiating",
  RINGING: "ringing",
  ACCEPTING: "accepting",
  ACCEPTED: "accepted",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  ACTIVE: "active",
  HELD: "held",
  ON_HOLD: "on_hold",
  RECONNECTING: "reconnecting",
  ENDED: "ended",
  REJECTED: "rejected",
  BUSY: "busy",
  FAILED: "failed",
  MISSED: "missed",
  CANCELLED: "cancelled",
});

export const CALL_TYPES = Object.freeze({
  AUDIO: "audio",
  VIDEO: "video",
});

export const CALL_SOCKET_EVENTS = Object.freeze({
  // One-to-one calling
  CALL_INVITE: "call:invite",
  CALL_INCOMING: "call:incoming",
  CALL_ACCEPT: "call:accept",
  CALL_ACCEPTED: "call:accepted",
  CALL_REJECT: "call:reject",
  CALL_CANCEL: "call:cancel",
  CALL_END: "call:end",
  CALL_ENDED: "call:ended",
  CALL_ANSWERED_ELSEWHERE: "call:answered-elsewhere",
  CALL_OFFER: "call:offer",
  CALL_ANSWER: "call:answer",
  CALL_ICE: "call:ice",
  CALL_MEDIA: "call:media",
  CALL_HOLD: "call:hold",
  CALL_HELD: "call:held",
  CALL_RESUME: "call:resume",
  CALL_RESUMED: "call:resumed",
  CALL_STATE: "call:state",
  CALL_GET_STATE: "call:get-state",
  CALL_WAITING: "call:waiting",
  CALL_RECONNECT: "call:reconnect",
  CALL_RECONNECTED: "call:reconnected",
  CALL_QUALITY: "call:quality",
  CALLS_READ: "calls:read",
  CALL_MISSED_CLEARED: "call:missed:cleared",
  CALL_REACTION: "call:reaction",
  CALL_CAPTION: "call:caption",
  CALL_SCREENSHARE: "call:screenshare",

  // Group calling
  GCALL_START: "gcall:start",
  GCALL_JOIN: "gcall:join",
  GCALL_STATUS: "gcall:status",
  GCALL_SIGNAL: "gcall:signal",
  GCALL_MEDIA: "gcall:media",
  GCALL_LEAVE: "gcall:leave",
  GCALL_INCOMING: "gcall:incoming",
  GCALL_PEER_JOINED: "gcall:peer-joined",
  GCALL_PEER_LEFT: "gcall:peer-left",
  GCALL_ENDED: "gcall:ended",
  GCALL_JOINED_ELSEWHERE: "gcall:joined-elsewhere",
  GCALL_REACTION: "gcall:reaction",
  GCALL_CAPTION: "gcall:caption",
  GCALL_SCREENSHARE: "gcall:screenshare",
  GCALL_KICK: "gcall:kick",
  GCALL_MUTE_PEER: "gcall:mute-peer",
});

export const CALL_REACTIONS = Object.freeze([
  "❤️",
  "😂",
  "👍",
  "👏",
  "🎉",
  "😮",
  "😢",
  "🔥",
]);

export const CALL_VIDEO_RESOLUTIONS = Object.freeze({
  RES_360P: "360p",
  RES_480P: "480p",
  RES_720P: "720p",
  RES_1080P: "1080p",
});

export const CALL_LIMITS = Object.freeze({
  RING_TIMEOUT_MS: 30000,
  GROUP_RING_TIMEOUT_MS: 45000,
  MAX_GROUP_CALL_PARTICIPANTS: 6,
  MAX_SDP_SIZE: 65536, // 64 KB
  MAX_CANDIDATE_SIZE: 4096, // 4 KB
  DEFAULT_PAGE_LIMIT: 50,
  MAX_PAGE_LIMIT: 100,
});

export const CALL_RING_TIMEOUT_MS = 40_000;
export const GROUP_CALL_RING_TIMEOUT_MS = 45_000;
export const MAX_CALL_PARTICIPANTS = 6;

export const CALL_ERROR_MESSAGES = Object.freeze({
  INVALID_USER_ID: "Invalid user ID.",
  INVALID_GROUP_ID: "Invalid group ID.",
  CANNOT_CALL_SELF: "You cannot call yourself.",
  USER_NOT_FOUND: "User not found or inactive.",
  USER_OFFLINE: "User is offline.",
  USER_BUSY: "User is busy on another call.",
  CALL_NOT_ALLOWED: "You cannot call this user.",
  CALL_NOT_FOUND: "Call not found or already terminated.",
  CALL_ALREADY_ANSWERED: "Call is already answered.",
  CALL_FORBIDDEN: "You are not authorized to participate in this call.",
  NOT_A_GROUP_MEMBER: "You are not a member of this group.",
  GROUP_NOT_FOUND: "Group not found.",
  GROUP_CALL_ALREADY_ACTIVE: "A call is already running in this group.",
  GROUP_CALL_FULL: "This call is full (max 6 participants).",
  INVALID_CALL_TYPE: "Call type must be 'audio' or 'video'.",
  MALFORMED_SDP: "Malformed SDP description.",
  MALFORMED_CANDIDATE: "Malformed ICE candidate.",
  RATE_LIMITED: "Rate limit exceeded. Please wait a moment.",
});
