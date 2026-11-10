import fs from "fs/promises";
import Group from "../models/group.model.js";
import GroupKey from "../models/group-key.model.js";
import Contact from "../../contacts/models/contact.model.js";
import User from "../../users/models/users.model.js";
import { canViewSync } from "../../privacy/services/privacy-visibility.service.js";

export const safeUnlink = async (filePath) => {
  if (!filePath) return;
  try {
    await fs.unlink(filePath);
  } catch (_err) {}
};

export const sid = (x) => String(x?._id ?? x);

export const getLatestKeyVersion = async (groupId) => {
  const latest = await GroupKey.findOne({ groupId })
    .sort({ version: -1 })
    .select("version")
    .lean();
  return latest?.version || 0;
};

export const getLatestVersions = async (groupIds) => {
  const rows = await GroupKey.aggregate([
    { $match: { groupId: { $in: groupIds } } },
    { $group: { _id: "$groupId", maxVersion: { $max: "$version" } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.maxVersion]));
};

export const loadGroup = (id) =>
  Group.findById(id).populate(
    "members.userId",
    "fullName avatar profilePhotoVisibility",
  );

export const formatGroup = (
  group,
  extra = {},
  viewerId = null,
  targetSavedViewerSet = null,
  blockedSet = null,
) => {
  const vId = viewerId ? String(viewerId) : null;
  return {
    id: group._id,
    name: group.name,
    avatar: group.avatar?.url || "",
    owner: sid(group.owner),
    members: group.members.map((m) => {
      const u = m.userId;
      const uid = sid(u);
      const isSelf = vId && uid === vId;
      const isBlocked = blockedSet ? blockedSet.has(uid) : false;

      let showPhoto = true;
      if (vId && !isSelf) {
        if (isBlocked) {
          showPhoto = false;
        } else {
          const vis = u?.profilePhotoVisibility ?? "everyone";
          showPhoto = canViewSync(vis, uid, vId, targetSavedViewerSet);
        }
      }

      return {
        id: uid,
        fullName: u?.fullName || "",
        avatar: showPhoto ? u?.avatar?.url || "" : "",
        role: m.role,
        joinedAt: m.joinedAt,
      };
    }),
    createdAt: group.createdAt,
    lastMessageAt: group.lastMessageAt || group.createdAt,
    unreadCount: 0,
    lastMessage: null,
    archived: false,
    e2ee: false,
    keyVersion: 0,
    keyRotationPending: !!group.keyRotationPending,
    ...extra,
  };
};

export const presentGroup = async (group, extra = {}, viewerId = null) => {
  const keyVersion = await getLatestKeyVersion(group._id);
  let targetSavedViewerSet = null;
  let blockedSet = null;

  if (viewerId) {
    const memberIds = group.members
      .map((m) => m.userId?._id || m.userId)
      .filter(Boolean);
    const [savedContacts, blockers, meDoc] = await Promise.all([
      Contact.find({ ownerId: { $in: memberIds }, contactId: viewerId })
        .select("ownerId")
        .lean(),
      User.find({ _id: { $in: memberIds }, blockedUsers: viewerId })
        .select("_id")
        .lean(),
      User.findById(viewerId).select("blockedUsers").lean(),
    ]);
    targetSavedViewerSet = new Set(savedContacts.map((c) => String(c.ownerId)));
    blockedSet = new Set([
      ...blockers.map((b) => String(b._id)),
      ...(meDoc?.blockedUsers || []).map(String),
    ]);
  }

  return formatGroup(
    group,
    { e2ee: keyVersion > 0, keyVersion, ...extra },
    viewerId,
    targetSavedViewerSet,
    blockedSet,
  );
};
