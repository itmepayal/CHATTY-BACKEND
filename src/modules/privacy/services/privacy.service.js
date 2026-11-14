/**
 * Privacy Service
 * Enforces user visibility rules, blocking checks, contact relationships, and data sanitization.
 */

import { StatusCodes } from "http-status-codes";
import * as userRepository from "../../users/repositories/user.repository.js";
import * as contactRepository from "../../contacts/repositories/contact.repository.js";
import ApiError from "../../../shared/errors/api-error.js";
import {
  isUserOnline,
  getPrivacy,
  getOrFetchPrivacy,
} from "../../../infrastructure/socket/socket-state.js";
import {
  toObjectId,
  isValidObjectId,
} from "../../../shared/utils/object-id.util.js";

const SENSITIVE_KEYS = [
  "password",
  "twoFactorSecret",
  "twoFactorPendingSecret",
  "recoveryCodes",
  "tokenVersion",
  "blockedUsers",
  "favorites",
  "publicKey",
  "passwordResetToken",
  "passwordResetExpires",
  "lastSeenVisibility",
  "onlineStatusVisibility",
  "profilePhotoVisibility",
  "aboutVisibility",
  "groupAddPermission",
  "readReceipts",
  "typingIndicator",
];

const sanitizePrivateKeys = (obj) => {
  if (!obj || typeof obj !== "object") return obj;
  for (const k of SENSITIVE_KEYS) {
    delete obj[k];
  }
  return obj;
};

/**
 * Checks if User A and User B have blocked each other in either direction.
 */
export const isBlockedEitherWay = async (a, b) => {
  if (!a || !b) return false;
  const aStr = String(a);
  const bStr = String(b);
  if (aStr === bStr) return false;

  const found = await userRepository.exists({
    $or: [
      { _id: a, blockedUsers: b },
      { _id: b, blockedUsers: a },
    ],
  });
  return Boolean(found);
};

/**
 * Checks if ownerId has contactId in their contacts list.
 */
export const isContact = async (ownerId, contactId) => {
  if (!ownerId || !contactId) return false;
  const oStr = String(ownerId);
  const cStr = String(contactId);
  if (oStr === cStr) return true;

  const found = await contactRepository.exists({ ownerId, contactId });
  return Boolean(found);
};

/**
 * Returns a Set of contact IDs that userId has saved in their contacts.
 */
export const getContactIdSet = async (userId) => {
  const me = String(userId);
  const rows = await contactRepository
    .find({ ownerId: userId })
    .select("contactId")
    .lean();
  const set = new Set();
  for (const r of rows) {
    const s = String(r.contactId);
    if (s !== me) set.add(s);
  }
  return set;
};

/**
 * Evaluates whether viewerId can view ownerId's data given visibility setting.
 */
export const canView = async (visibility, ownerId, viewerId) => {
  const oStr = String(ownerId);
  const vStr = String(viewerId);
  if (oStr === vStr) return true;
  if (visibility === "nobody") return false;

  if (await isBlockedEitherWay(oStr, vStr)) return false;
  if (visibility === "everyone") return true;

  // "contacts" requires ownerId to have saved viewerId in their contacts
  return isContact(ownerId, viewerId);
};

/**
 * Synchronous evaluation when contacts set is already known.
 */
export const canViewSync = (visibility, ownerId, viewerId, contacts) => {
  if (String(ownerId) === String(viewerId)) return true;
  if (visibility === "nobody") return false;
  if (visibility === "everyone") return true;

  if (contacts instanceof Set) return contacts.has(String(ownerId));
  if (Array.isArray(contacts)) {
    return contacts.some((c) => String(c) === String(ownerId));
  }
  return Boolean(contacts);
};

/**
 * Get authoritative lastSeenVisibility for a user.
 */
export const getLastSeenVisibility = async (userId) => {
  const user = await userRepository
    .findById(userId)
    .select("lastSeenVisibility")
    .lean();
  return user?.lastSeenVisibility ?? "contacts";
};

/**
 * Get authoritative onlineStatusVisibility for a user.
 */
export const getOnlineStatusVisibility = async (userId) => {
  const user = await userRepository
    .findById(userId)
    .select("onlineStatusVisibility showOnlineStatus")
    .lean();
  if (!user) return "everyone";
  if (user.showOnlineStatus === false) return "nobody";
  return user.onlineStatusVisibility ?? "everyone";
};

/**
 * Check if viewerId can view targetUserId's last seen timestamp.
 */
export const canViewLastSeen = async (viewerId, targetUserId) => {
  if (String(viewerId) === String(targetUserId)) return true;
  if (await isBlockedEitherWay(viewerId, targetUserId)) return false;

  const target = await userRepository
    .findById(targetUserId)
    .select("lastSeenVisibility")
    .lean();
  if (!target) return false;

  return canView(
    target.lastSeenVisibility ?? "contacts",
    targetUserId,
    viewerId,
  );
};

/**
 * Check if viewerId can view targetUserId's real-time online status.
 */
export const canViewOnlineStatus = async (viewerId, targetUserId) => {
  if (String(viewerId) === String(targetUserId)) return true;
  if (await isBlockedEitherWay(viewerId, targetUserId)) return false;

  const target = await userRepository
    .findById(targetUserId)
    .select("showOnlineStatus onlineStatusVisibility lastSeenVisibility")
    .lean();
  if (!target) return false;

  const onlineVis =
    target.showOnlineStatus === false
      ? "nobody"
      : (target.onlineStatusVisibility ?? "everyone");

  if (onlineVis === "nobody") return false;

  return canView(onlineVis, targetUserId, viewerId);
};

/**
 * Check if viewerId can view targetUserId's profile photo.
 */
export const canViewProfilePhoto = async (viewerId, targetUserId) => {
  if (String(viewerId) === String(targetUserId)) return true;
  if (await isBlockedEitherWay(viewerId, targetUserId)) return false;

  const target = await userRepository
    .findById(targetUserId)
    .select("profilePhotoVisibility")
    .lean();
  if (!target) return false;

  return canView(
    target.profilePhotoVisibility ?? "everyone",
    targetUserId,
    viewerId,
  );
};

/**
 * Check if viewerId can view targetUserId's about / bio.
 */
export const canViewAbout = async (viewerId, targetUserId) => {
  if (String(viewerId) === String(targetUserId)) return true;
  if (await isBlockedEitherWay(viewerId, targetUserId)) return false;

  const target = await userRepository
    .findById(targetUserId)
    .select("aboutVisibility")
    .lean();
  if (!target) return false;

  return canView(target.aboutVisibility ?? "contacts", targetUserId, viewerId);
};

/**
 * Check if actorId has permission to add targetUserId to a group directly.
 */
export const canAddUserToGroup = async (actorId, targetUserId) => {
  if (!actorId || !targetUserId) return false;
  if (String(actorId) === String(targetUserId)) return true;
  if (await isBlockedEitherWay(actorId, targetUserId)) return false;

  const target = await userRepository
    .findById(targetUserId)
    .select("groupAddPermission")
    .lean();
  if (!target) return false;

  const permission = target.groupAddPermission ?? "contacts";
  if (permission === "nobody") return false;
  if (permission === "everyone") return true;

  // "contacts" requires target to have actor in contacts
  return isContact(targetUserId, actorId);
};

/**
 * Checks reciprocal read receipt exchange permission between viewer and sender.
 */
export const canSendReadReceipt = async (viewerId, senderId) => {
  if (!viewerId || !senderId) return false;
  if (String(viewerId) === String(senderId)) return true;
  if (await isBlockedEitherWay(viewerId, senderId)) return false;

  const [viewerPriv, senderPriv] = await Promise.all([
    getOrFetchPrivacy(viewerId),
    getOrFetchPrivacy(senderId),
  ]);

  return Boolean(
    viewerPriv.readReceipts !== false && senderPriv.readReceipts !== false,
  );
};

/**
 * Checks typing indicator emission permission from sender to receiver.
 */
export const canSendTypingIndicator = async (senderId, receiverId) => {
  if (!senderId || !receiverId) return false;
  if (String(senderId) === String(receiverId)) return false;
  if (await isBlockedEitherWay(senderId, receiverId)) return false;

  const senderPriv = await getOrFetchPrivacy(senderId);
  return Boolean(senderPriv.typingIndicator !== false);
};

/**
 * Returns filtered real-time presence (online status and lastSeen) for viewer.
 */
export const getPresenceForViewer = async (viewerId, targetUserId) => {
  const isOnline = isUserOnline(targetUserId);

  if (isOnline) {
    const canSeeOnline = await canViewOnlineStatus(viewerId, targetUserId);
    if (canSeeOnline) {
      return { isOnline: true, lastSeen: null };
    }
  }

  // Target is offline or hiding online status: check if viewer can see lastSeen timestamp
  const canSeeLastSeen = await canViewLastSeen(viewerId, targetUserId);
  if (!canSeeLastSeen) {
    return { isOnline: false, lastSeen: null };
  }

  const target = await userRepository
    .findById(targetUserId)
    .select("lastSeen")
    .lean();
  return {
    isOnline: false,
    lastSeen: target?.lastSeen || null,
  };
};

export const getFilteredPresence = getPresenceForViewer;

/**
 * Batch validate group add permission for multiple targets.
 */
export const checkGroupAddPermission = async (adderId, targetIds) => {
  const adder = String(adderId);
  const targets = await userRepository
    .find({ _id: { $in: targetIds } })
    .select("groupAddPermission blockedUsers fullName")
    .lean();

  const foundMap = new Map(targets.map((t) => [String(t._id), t]));
  const targetObjectIds = targets.map((t) => t._id);
  const contactsWhoSavedAdder = await contactRepository
    .find({
      ownerId: { $in: targetObjectIds },
      contactId: adder,
    })
    .select("ownerId")
    .lean();

  const adderInContactsSet = new Set(
    contactsWhoSavedAdder.map((c) => String(c.ownerId)),
  );

  const me = await userRepository.findById(adder).select("blockedUsers").lean();
  const myBlockedSet = new Set((me?.blockedUsers || []).map(String));

  const allowed = [];
  const denied = [];
  const reasons = {};

  for (const rawId of targetIds) {
    const id = String(rawId);
    const t = foundMap.get(id);

    if (!t) {
      denied.push(id);
      reasons[id] = "This user does not allow you to add them to groups.";
      continue;
    }

    const isTargetBlockedByAdder = myBlockedSet.has(id);
    const isAdderBlockedByTarget = (t.blockedUsers || []).some(
      (b) => String(b) === adder,
    );

    if (isTargetBlockedByAdder || isAdderBlockedByTarget) {
      denied.push(id);
      // Generic denial text to prevent leaking block status to the blocked party
      reasons[id] = "This user does not allow you to add them to groups.";
      continue;
    }

    const perm = t.groupAddPermission ?? "contacts";
    if (perm === "everyone") {
      allowed.push(id);
    } else if (perm === "contacts") {
      if (adderInContactsSet.has(id)) {
        allowed.push(id);
      } else {
        denied.push(id);
        reasons[id] = "This user does not allow you to add them to groups.";
      }
    } else {
      // nobody
      denied.push(id);
      reasons[id] = "This user does not allow you to add them to groups.";
    }
  }

  return { allowed, denied, reasons };
};

/**
 * Assert that all targetIds can be added to group by adderId, throwing 403 otherwise.
 */
export const assertCanAddToGroup = async (adderId, targetIds) => {
  const { denied, reasons } = await checkGroupAddPermission(adderId, targetIds);
  if (denied.length > 0) {
    const firstReason =
      reasons[denied[0]] ||
      "This user does not allow you to add them to groups.";
    const err = new ApiError(StatusCodes.FORBIDDEN, firstReason);
    err.code = "GROUP_ADD_PERMISSION_DENIED";
    err.errorCode = "GROUP_ADD_PERMISSION_DENIED";
    throw err;
  }
};

/**
 * Returns sanitized and authoritative user profile for viewer.
 */
export const getFilteredUserProfile = async (viewerId, targetUserId) => {
  if (!isValidObjectId(targetUserId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }

  const target = await userRepository
    .findById(targetUserId)
    .select(
      "fullName username avatar bio lastSeen showOnlineStatus onlineStatusVisibility lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission blockedUsers location website createdAt updatedAt",
    )
    .lean();

  if (!target) {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const isSelf = String(viewerId) === String(targetUserId);
  if (isSelf) {
    return {
      id: String(target._id),
      _id: target._id,
      fullName: target.fullName,
      username: target.username || "",
      avatar: target.avatar?.url || target.avatar || "",
      bio: target.bio || "",
      lastSeen: target.lastSeen || null,
      showOnlineStatus: target.showOnlineStatus !== false,
      onlineStatusVisibility: target.onlineStatusVisibility ?? "everyone",
      location: target.location || "",
      website: target.website || "",
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
    };
  }

  const [blockedByViewer, blockedByTarget] = await Promise.all([
    userRepository.exists({ _id: viewerId, blockedUsers: targetUserId }),
    userRepository.exists({ _id: targetUserId, blockedUsers: viewerId }),
  ]);
  const isBlockedEither = Boolean(blockedByViewer || blockedByTarget);
  if (isBlockedEither) {
    return {
      id: String(target._id),
      _id: target._id,
      fullName: target.fullName,
      username: target.username || "",
      avatar: null,
      bio: "",
      lastSeen: null,
      showOnlineStatus: false,
      // Only disclose isBlocked: true if viewer initiated the block. Never reveal if target blocked viewer.
      isBlocked: Boolean(blockedByViewer),
      location: "",
      website: "",
    };
  }

  const inTargetContacts = await isContact(targetUserId, viewerId);
  const showPhoto = canViewSync(
    target.profilePhotoVisibility ?? "everyone",
    targetUserId,
    viewerId,
    inTargetContacts,
  );
  const showLastSeen = canViewSync(
    target.lastSeenVisibility ?? "contacts",
    targetUserId,
    viewerId,
    inTargetContacts,
  );
  const showAbout = canViewSync(
    target.aboutVisibility ?? "contacts",
    targetUserId,
    viewerId,
    inTargetContacts,
  );

  const onlineVis =
    target.showOnlineStatus === false
      ? "nobody"
      : (target.onlineStatusVisibility ?? "everyone");
  const showOnline = canViewSync(
    onlineVis,
    targetUserId,
    viewerId,
    inTargetContacts,
  );

  return {
    id: String(target._id),
    _id: target._id,
    fullName: target.fullName,
    username: target.username || "",
    avatar: showPhoto ? target.avatar?.url || target.avatar || "" : null,
    bio: showAbout ? target.bio || "" : "",
    lastSeen: showLastSeen ? target.lastSeen || null : null,
    showOnlineStatus: showOnline,
    location: showAbout ? target.location || "" : "",
    website: showAbout ? target.website || "" : "",
    createdAt: target.createdAt,
    updatedAt: target.updatedAt,
  };
};

export const getVisibleUserProfile = getFilteredUserProfile;

/**
 * Sanitizes a single user object for viewer.
 */
export const sanitizeUserForViewer = async (user, viewerId) => {
  if (!user) return user;

  const obj =
    typeof user.toObject === "function" ? user.toObject() : { ...user };
  const rawId = obj._id ?? obj.id;
  const ownerId = String(rawId);
  const vId = String(viewerId);

  if (ownerId === vId) {
    return sanitizePrivateKeys(obj);
  }

  const isBlocked = await isBlockedEitherWay(vId, ownerId);
  if (isBlocked) {
    obj.avatar = null;
    obj.bio = "";
    obj.about = "";
    delete obj.lastSeen;
    obj.showOnlineStatus = false;
    return sanitizePrivateKeys(obj);
  }

  const inTargetContacts = await isContact(ownerId, vId);

  const photoOk = canViewSync(
    obj.profilePhotoVisibility ?? "everyone",
    ownerId,
    vId,
    inTargetContacts,
  );
  const lastSeenOk = canViewSync(
    obj.lastSeenVisibility ?? "contacts",
    ownerId,
    vId,
    inTargetContacts,
  );
  const aboutOk = canViewSync(
    obj.aboutVisibility ?? "contacts",
    ownerId,
    vId,
    inTargetContacts,
  );

  const onlineVis =
    obj.showOnlineStatus === false
      ? "nobody"
      : (obj.onlineStatusVisibility ?? "everyone");
  const onlineOk = canViewSync(onlineVis, ownerId, vId, inTargetContacts);

  if (!photoOk) {
    if (typeof obj.avatar === "object" && obj.avatar !== null) {
      obj.avatar = { public_id: "", url: "" };
    } else {
      obj.avatar = null;
    }
    obj.avatarUrl = "";
  }
  if (!lastSeenOk) {
    delete obj.lastSeen;
  }
  if (!onlineOk) {
    obj.showOnlineStatus = false;
  }
  if (!aboutOk) {
    obj.bio = "";
    obj.about = "";
    obj.location = "";
    obj.website = "";
  }

  return sanitizePrivateKeys(obj);
};

export const filterUserForViewer = sanitizeUserForViewer;

export const sanitizeUsersForViewer = async (users, viewerId) => {
  if (!Array.isArray(users) || !users.length) return [];
  const vId = String(viewerId);

  const targetIds = [];
  for (const u of users) {
    const rawId = u?._id ?? u?.id ?? u;
    if (rawId && String(rawId) !== vId) {
      targetIds.push(toObjectId(rawId));
    }
  }

  if (!targetIds.length) {
    return users.map((u) => {
      const obj = typeof u?.toObject === "function" ? u.toObject() : { ...u };
      return sanitizePrivateKeys(obj);
    });
  }

  const [meDoc, blockers, contactsWhoSavedViewer] = await Promise.all([
    userRepository.findById(vId).select("blockedUsers").lean(),
    userRepository
      .find({ _id: { $in: targetIds }, blockedUsers: vId })
      .select("_id")
      .lean(),
    contactRepository
      .find({ ownerId: { $in: targetIds }, contactId: vId })
      .select("ownerId")
      .lean(),
  ]);

  const blockedByMe = new Set((meDoc?.blockedUsers || []).map(String));
  const blockedMe = new Set(blockers.map((b) => String(b._id)));
  const targetSavedViewerSet = new Set(
    contactsWhoSavedViewer.map((c) => String(c.ownerId)),
  );

  return users.map((u) => {
    if (!u) return u;
    const obj = typeof u.toObject === "function" ? u.toObject() : { ...u };
    const rawId = obj._id ?? obj.id;
    const ownerId = String(rawId);

    if (ownerId === vId) {
      return sanitizePrivateKeys(obj);
    }

    const isBlocked = blockedByMe.has(ownerId) || blockedMe.has(ownerId);
    if (isBlocked) {
      if (typeof obj.avatar === "object" && obj.avatar !== null) {
        obj.avatar = { public_id: "", url: "" };
      } else {
        obj.avatar = null;
      }
      obj.avatarUrl = "";
      obj.bio = "";
      obj.about = "";
      delete obj.lastSeen;
      obj.showOnlineStatus = false;
      return sanitizePrivateKeys(obj);
    }

    const inTargetContacts = targetSavedViewerSet.has(ownerId);

    const photoOk = canViewSync(
      obj.profilePhotoVisibility ?? "everyone",
      ownerId,
      vId,
      inTargetContacts,
    );
    const lastSeenOk = canViewSync(
      obj.lastSeenVisibility ?? "contacts",
      ownerId,
      vId,
      inTargetContacts,
    );
    const aboutOk = canViewSync(
      obj.aboutVisibility ?? "contacts",
      ownerId,
      vId,
      inTargetContacts,
    );
    const onlineVis =
      obj.showOnlineStatus === false
        ? "nobody"
        : (obj.onlineStatusVisibility ?? "everyone");
    const onlineOk = canViewSync(onlineVis, ownerId, vId, inTargetContacts);

    if (!photoOk) {
      if (typeof obj.avatar === "object" && obj.avatar !== null) {
        obj.avatar = { public_id: "", url: "" };
      } else {
        obj.avatar = null;
      }
      obj.avatarUrl = "";
    }
    if (!lastSeenOk) {
      delete obj.lastSeen;
    }
    if (!onlineOk) {
      obj.showOnlineStatus = false;
    }
    if (!aboutOk) {
      obj.bio = "";
      obj.about = "";
      obj.location = "";
      obj.website = "";
    }

    return sanitizePrivateKeys(obj);
  });
};

export const filterUsersForViewer = sanitizeUsersForViewer;

export const buildPrivacyAwareNotification = async ({
  recipientId,
  sender,
  message,
  type = "message",
}) => {
  const rId = String(recipientId);
  const sId = String(sender?._id || sender?.id || sender);

  const blocked = await isBlockedEitherWay(rId, sId);
  if (blocked) {
    return null;
  }

  const showAvatar = await canViewProfilePhoto(rId, sId);

  const senderName = sender?.fullName || "Chatty User";
  const avatarUrl = showAvatar
    ? sender?.avatar?.url || sender?.avatar || null
    : null;

  const body = message?.isDeleted
    ? "This message was deleted"
    : message?.e2ee
      ? "🔒 Encrypted message"
      : message?.text ||
        (message?.image
          ? "📷 Photo"
          : message?.file
            ? "📎 File"
            : message?.audio
              ? "🎵 Audio"
              : message?.video
                ? "🎥 Video"
                : "New message");

  return {
    recipientId: rId,
    title: senderName,
    body,
    data: {
      type,
      senderId: sId,
      messageId: message?._id ? String(message._id) : undefined,
      avatarUrl,
    },
  };
};

const privacyService = {
  isBlockedEitherWay,
  isContact,
  getContactIdSet,
  canView,
  canViewSync,
  getLastSeenVisibility,
  getOnlineStatusVisibility,
  canViewLastSeen,
  canViewOnlineStatus,
  canViewProfilePhoto,
  canViewAbout,
  canAddUserToGroup,
  canSendReadReceipt,
  canSendTypingIndicator,
  getPresenceForViewer,
  getFilteredPresence,
  checkGroupAddPermission,
  assertCanAddToGroup,
  getFilteredUserProfile,
  getVisibleUserProfile,
  sanitizeUserForViewer,
  filterUserForViewer,
  sanitizeUsersForViewer,
  filterUsersForViewer,
  buildPrivacyAwareNotification,
};

export default privacyService;
