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
export const canView = async (
  visibility,
  ownerId,
  viewerId,
  exceptions = [],
  included = [],
) => {
  const oStr = String(ownerId);
  const vStr = String(viewerId);
  if (oStr === vStr) return true;
  if (visibility === "nobody") return false;

  if (await isBlockedEitherWay(oStr, vStr)) return false;
  if (visibility === "everyone") return true;

  if (visibility === "only_share_with") {
    const incSet = new Set((included || []).map(String));
    return incSet.has(vStr);
  }

  const isSavedContact = await isContact(ownerId, viewerId);
  if (!isSavedContact) return false;

  if (visibility === "contacts_except") {
    const excSet = new Set((exceptions || []).map(String));
    if (excSet.has(vStr)) return false;
  }

  return true;
};

/**
 * Synchronous evaluation when contacts set is already known.
 */
export const canViewSync = (
  visibility,
  ownerId,
  viewerId,
  contacts,
  exceptions = [],
  included = [],
) => {
  const oStr = String(ownerId);
  const vStr = String(viewerId);
  if (oStr === vStr) return true;

  const vis = String(visibility || "everyone").toLowerCase();
  if (vis === "everyone") return true;
  if (vis === "nobody") return false;

  if (vis === "only_share_with") {
    const incSet = new Set((included || []).map(String));
    return incSet.has(vStr);
  }

  let isSavedContact = false;
  if (contacts instanceof Set) {
    isSavedContact = contacts.has(oStr) || contacts.has(vStr);
  } else if (Array.isArray(contacts)) {
    isSavedContact = contacts.some((c) => String(c) === oStr || String(c) === vStr);
  } else {
    isSavedContact = Boolean(contacts);
  }

  if (!isSavedContact) return false;

  if (vis === "contacts_except") {
    const excSet = new Set((exceptions || []).map(String));
    if (excSet.has(vStr)) return false;
  }

  return true;
};

/**
 * Get authoritative lastSeenVisibility for a user.
 */
export const getLastSeenVisibility = async (userId) => {
  const user = await userRepository
    .findById(userId)
    .select("lastSeenVisibility")
    .lean();
  return user?.lastSeenVisibility ?? "everyone";
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
    .select("lastSeenVisibility lastSeenExceptions")
    .lean();
  if (!target) return false;

  return canView(
    target.lastSeenVisibility ?? "everyone",
    targetUserId,
    viewerId,
    target.lastSeenExceptions || [],
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
    .select("showOnlineStatus onlineStatusVisibility lastSeenVisibility lastSeenExceptions")
    .lean();
  if (!target) return false;

  let effectiveOnlineVis =
    target.showOnlineStatus === false
      ? "nobody"
      : (target.onlineStatusVisibility ?? "everyone");
  let effectiveOnlineExceptions = target.lastSeenExceptions || [];
  if (effectiveOnlineVis === "same_as_last_seen") {
    effectiveOnlineVis = target.lastSeenVisibility ?? "everyone";
    effectiveOnlineExceptions = target.lastSeenExceptions || [];
  }

  if (effectiveOnlineVis === "nobody") return false;

  return canView(
    effectiveOnlineVis,
    targetUserId,
    viewerId,
    effectiveOnlineExceptions,
  );
};

/**
 * Check if viewerId can view targetUserId's profile photo.
 */
export const canViewProfilePhoto = async (viewerId, targetUserId) => {
  if (String(viewerId) === String(targetUserId)) return true;
  if (await isBlockedEitherWay(viewerId, targetUserId)) return false;

  const target = await userRepository
    .findById(targetUserId)
    .select("profilePhotoVisibility profilePhotoExceptions")
    .lean();
  if (!target) return false;

  return canView(
    target.profilePhotoVisibility ?? "everyone",
    targetUserId,
    viewerId,
    target.profilePhotoExceptions || [],
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
    .select("aboutVisibility aboutExceptions")
    .lean();
  if (!target) return false;

  return canView(
    target.aboutVisibility ?? "everyone",
    targetUserId,
    viewerId,
    target.aboutExceptions || [],
  );
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

  const permission = target.groupAddPermission ?? "everyone";
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
    .select("groupAddPermission groupAddExceptions blockedUsers fullName")
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

    const perm = t.groupAddPermission ?? "everyone";
    if (perm === "everyone") {
      allowed.push(id);
    } else if (perm === "contacts") {
      if (adderInContactsSet.has(id)) {
        allowed.push(id);
      } else {
        denied.push(id);
        reasons[id] = "This user does not allow you to add them to groups.";
      }
    } else if (perm === "contacts_except") {
      const isExcluded = (t.groupAddExceptions || []).some(
        (exId) => String(exId) === adder,
      );
      if (adderInContactsSet.has(id) && !isExcluded) {
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
      "fullName username avatar bio customStatus lastSeen showOnlineStatus onlineStatusVisibility lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission lastSeenExceptions profilePhotoExceptions aboutExceptions groupAddExceptions statusVisibility statusExceptions statusIncluded blockedUsers location website createdAt updatedAt readReceipts typingIndicator",
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
      customStatus: target.customStatus || "",
      lastSeen: target.lastSeen || null,
      showOnlineStatus: target.showOnlineStatus !== false,
      onlineStatusVisibility: target.onlineStatusVisibility ?? "everyone",
      readReceipts: target.readReceipts !== false,
      typingIndicator: target.typingIndicator !== false,
      location: target.location || "",
      website: target.website || "",
      isAboutRestricted: false,
      isPhotoRestricted: false,
      isLastSeenRestricted: false,
      isOnlineRestricted: false,
      canAddToGroup: true,
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
      customStatus: "",
      lastSeen: null,
      showOnlineStatus: false,
      readReceipts: false,
      typingIndicator: false,
      // Only disclose isBlocked: true if viewer initiated the block. Never reveal if target blocked viewer.
      isBlocked: Boolean(blockedByViewer),
      location: "",
      website: "",
      isAboutRestricted: true,
      isPhotoRestricted: true,
      isLastSeenRestricted: true,
      isOnlineRestricted: true,
      canAddToGroup: false,
    };
  }

  const inTargetContacts = await isContact(targetUserId, viewerId);
  const showPhoto = canViewSync(
    target.profilePhotoVisibility ?? "everyone",
    targetUserId,
    viewerId,
    inTargetContacts,
    target.profilePhotoExceptions || [],
  );
  const showLastSeen = canViewSync(
    target.lastSeenVisibility ?? "everyone",
    targetUserId,
    viewerId,
    inTargetContacts,
    target.lastSeenExceptions || [],
  );
  const showAbout = canViewSync(
    target.aboutVisibility ?? "everyone",
    targetUserId,
    viewerId,
    inTargetContacts,
    target.aboutExceptions || [],
  );

  let effectiveOnlineVis = target.onlineStatusVisibility ?? "everyone";
  let effectiveOnlineExceptions = target.lastSeenExceptions || [];
  if (effectiveOnlineVis === "same_as_last_seen") {
    effectiveOnlineVis = target.lastSeenVisibility ?? "everyone";
    effectiveOnlineExceptions = target.lastSeenExceptions || [];
  }
  if (target.showOnlineStatus === false) {
    effectiveOnlineVis = "nobody";
  }

  const showOnline = canViewSync(
    effectiveOnlineVis,
    targetUserId,
    viewerId,
    inTargetContacts,
    effectiveOnlineExceptions,
  );

  const groupAddPerm = target.groupAddPermission ?? "everyone";
  const isExcludedFromGroup = (target.groupAddExceptions || []).some(
    (exId) => String(exId) === String(viewerId),
  );
  const canAddToGroup =
    groupAddPerm === "everyone" ||
    (groupAddPerm === "contacts" && inTargetContacts) ||
    (groupAddPerm === "contacts_except" && inTargetContacts && !isExcludedFromGroup);

  const canReceipt = await canSendReadReceipt(viewerId, targetUserId);

  return {
    id: String(target._id),
    _id: target._id,
    fullName: target.fullName,
    username: target.username || "",
    avatar: showPhoto ? target.avatar?.url || target.avatar || "" : null,
    bio: showAbout ? target.bio || "" : "",
    customStatus: showAbout ? target.customStatus || "" : "",
    lastSeen: showLastSeen ? target.lastSeen || null : null,
    showOnlineStatus: showOnline,
    readReceipts: canReceipt,
    typingIndicator: target.typingIndicator !== false,
    location: showAbout ? target.location || "" : "",
    website: showAbout ? target.website || "" : "",
    isAboutRestricted: !showAbout,
    isPhotoRestricted: !showPhoto,
    isLastSeenRestricted: !showLastSeen,
    isOnlineRestricted: !showOnline,
    canAddToGroup,
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
    obj.avatarUrl = "";
    obj.bio = "";
    obj.about = "";
    obj.customStatus = "";
    delete obj.lastSeen;
    obj.showOnlineStatus = false;
    obj.isPhotoRestricted = true;
    obj.isLastSeenRestricted = true;
    obj.isOnlineRestricted = true;
    obj.isAboutRestricted = true;
    obj.canAddToGroup = false;
    return sanitizePrivateKeys(obj);
  }

  const inTargetContacts = await isContact(ownerId, vId);

  const photoOk = canViewSync(
    obj.profilePhotoVisibility ?? "everyone",
    ownerId,
    vId,
    inTargetContacts,
    obj.profilePhotoExceptions || [],
  );
  const lastSeenOk = canViewSync(
    obj.lastSeenVisibility ?? "everyone",
    ownerId,
    vId,
    inTargetContacts,
    obj.lastSeenExceptions || [],
  );
  const aboutOk = canViewSync(
    obj.aboutVisibility ?? "everyone",
    ownerId,
    vId,
    inTargetContacts,
    obj.aboutExceptions || [],
  );

  let effectiveOnlineVis =
    obj.showOnlineStatus === false
      ? "nobody"
      : (obj.onlineStatusVisibility ?? "everyone");
  let effectiveOnlineExceptions = obj.lastSeenExceptions || [];
  if (effectiveOnlineVis === "same_as_last_seen") {
    effectiveOnlineVis = obj.lastSeenVisibility ?? "everyone";
    effectiveOnlineExceptions = obj.lastSeenExceptions || [];
  }
  const onlineOk = canViewSync(
    effectiveOnlineVis,
    ownerId,
    vId,
    inTargetContacts,
    effectiveOnlineExceptions,
  );

  const groupAddPerm = obj.groupAddPermission ?? "everyone";
  const isExcludedFromGroup = (obj.groupAddExceptions || []).some(
    (exId) => String(exId) === vId,
  );
  obj.canAddToGroup =
    groupAddPerm === "everyone" ||
    (groupAddPerm === "contacts" && inTargetContacts) ||
    (groupAddPerm === "contacts_except" && inTargetContacts && !isExcludedFromGroup);

  obj.isPhotoRestricted = !photoOk;
  obj.isLastSeenRestricted = !lastSeenOk;
  obj.isOnlineRestricted = !onlineOk;
  obj.isAboutRestricted = !aboutOk;

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
    obj.customStatus = "";
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
      obj.avatar = null;
      obj.avatarUrl = "";
      obj.bio = "";
      obj.about = "";
      obj.customStatus = "";
      delete obj.lastSeen;
      obj.showOnlineStatus = false;
      obj.isPhotoRestricted = true;
      obj.isLastSeenRestricted = true;
      obj.isOnlineRestricted = true;
      obj.isAboutRestricted = true;
      obj.canAddToGroup = false;
      return sanitizePrivateKeys(obj);
    }

    const inTargetContacts = targetSavedViewerSet.has(ownerId);

    const photoOk = canViewSync(
      obj.profilePhotoVisibility ?? "everyone",
      ownerId,
      vId,
      inTargetContacts,
      obj.profilePhotoExceptions || [],
    );
    const lastSeenOk = canViewSync(
      obj.lastSeenVisibility ?? "everyone",
      ownerId,
      vId,
      inTargetContacts,
      obj.lastSeenExceptions || [],
    );
    const aboutOk = canViewSync(
      obj.aboutVisibility ?? "everyone",
      ownerId,
      vId,
      inTargetContacts,
      obj.aboutExceptions || [],
    );
    let effectiveOnlineVis =
      obj.showOnlineStatus === false
        ? "nobody"
        : (obj.onlineStatusVisibility ?? "everyone");
    let effectiveOnlineExceptions = obj.lastSeenExceptions || [];
    if (effectiveOnlineVis === "same_as_last_seen") {
      effectiveOnlineVis = obj.lastSeenVisibility ?? "everyone";
      effectiveOnlineExceptions = obj.lastSeenExceptions || [];
    }
    const onlineOk = canViewSync(
      effectiveOnlineVis,
      ownerId,
      vId,
      inTargetContacts,
      effectiveOnlineExceptions,
    );

    const groupAddPerm = obj.groupAddPermission ?? "everyone";
    const isExcludedFromGroup = (obj.groupAddExceptions || []).some(
      (exId) => String(exId) === vId,
    );
    obj.canAddToGroup =
      groupAddPerm === "everyone" ||
      (groupAddPerm === "contacts" && inTargetContacts) ||
      (groupAddPerm === "contacts_except" && inTargetContacts && !isExcludedFromGroup);

    obj.isPhotoRestricted = !photoOk;
    obj.isLastSeenRestricted = !lastSeenOk;
    obj.isOnlineRestricted = !onlineOk;
    obj.isAboutRestricted = !aboutOk;

    if (!photoOk) {
      obj.avatar = null;
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
      obj.customStatus = "";
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
