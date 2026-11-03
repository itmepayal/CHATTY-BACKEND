import User from "../models/users.model.js";
import Message from "../models/message.model.js";
import ApiError from "../utils/api-error.js";
import { StatusCodes } from "http-status-codes";

export const isContact = async (a, b) => {
  const found = await Message.exists({
    $or: [
      { senderId: a, receiverId: b },
      { senderId: b, receiverId: a },
    ],
  });
  return Boolean(found);
};

export const getContactIdSet = async (userId) => {
  const me = String(userId);

  const [sentTo, receivedFrom] = await Promise.all([
    Message.distinct("receiverId", { senderId: userId }),
    Message.distinct("senderId", { receiverId: userId }),
  ]);

  const set = new Set();
  for (const id of [...sentTo, ...receivedFrom]) {
    const s = String(id);
    if (s !== me) set.add(s);
  }
  return set;
};

export const canView = async (visibility, ownerId, viewerId) => {
  if (String(ownerId) === String(viewerId)) return true;
  if (visibility === "everyone") return true;
  if (visibility === "nobody") return false;
  return isContact(ownerId, viewerId);
};

export const canViewSync = (visibility, ownerId, viewerId, contacts) => {
  if (String(ownerId) === String(viewerId)) return true;
  if (visibility === "everyone") return true;
  if (visibility === "nobody") return false;

  if (contacts instanceof Set) return contacts.has(String(ownerId));
  if (Array.isArray(contacts)) {
    return contacts.some((c) => String(c) === String(ownerId));
  }
  return Boolean(contacts);
};

export const filterUserForViewer = async (user, viewerId) => {
  if (!user) return user;

  const obj =
    typeof user.toObject === "function" ? user.toObject() : { ...user };
  const ownerId = String(obj._id ?? obj.id);

  if (ownerId === String(viewerId)) return obj;

  const [lastSeenOk, photoOk, aboutOk] = await Promise.all([
    canView(obj.lastSeenVisibility ?? "contacts", ownerId, viewerId),
    canView(obj.profilePhotoVisibility ?? "everyone", ownerId, viewerId),
    canView(obj.aboutVisibility ?? "contacts", ownerId, viewerId),
  ]);

  if (!lastSeenOk) delete obj.lastSeen;
  if (!photoOk) obj.avatar = undefined;
  if (!aboutOk) delete obj.bio;

  for (const k of [
    "lastSeenVisibility",
    "profilePhotoVisibility",
    "aboutVisibility",
    "groupAddPermission",
    "showOnlineStatus",
    "readReceipts",
    "typingIndicator",
    "blockedUsers",
    "favorites",
  ]) {
    delete obj[k];
  }

  return obj;
};

export const filterUsersForViewer = (users, viewerId) =>
  Promise.all(users.map((u) => filterUserForViewer(u, viewerId)));

export const checkGroupAddPermission = async (adderId, targetIds) => {
  const targets = await User.find({ _id: { $in: targetIds } })
    .select("groupAddPermission blockedUsers")
    .lean();

  const allowed = [];
  const denied = [];

  for (const t of targets) {
    const id = String(t._id);
    const blocked = (t.blockedUsers || []).some(
      (b) => String(b) === String(adderId),
    );
    const ok =
      !blocked &&
      (await canView(t.groupAddPermission ?? "contacts", id, adderId));
    (ok ? allowed : denied).push(id);
  }

  return { allowed, denied };
};

export const assertCanAddToGroup = async (adderId, targetIds) => {
  const { denied } = await checkGroupAddPermission(adderId, targetIds);
  if (denied.length) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Some users cannot be added to this group due to their privacy settings.",
    );
  }
};
