import Group from "../models/group.model.js";
import GroupCall from "../models/group-call.model.js";
import User from "../models/users.model.js";
import Contact from "../models/contact.model.js";
import { sid } from "./group.service.js";
import { canViewSync } from "./privacy-visibility.service.js";

export const formatGroupCall = (c, meId, targetSavedMeSet, blockedSet) => {
  const isStartedByMe = sid(c.startedBy) === String(meId);
  let avatarUrl = "";
  if (c.startedBy?._id) {
    if (isStartedByMe) {
      avatarUrl = c.startedBy.avatar?.url || "";
    } else {
      const starterIdStr = sid(c.startedBy);
      const isBlocked = blockedSet?.has(starterIdStr);
      const inContacts = targetSavedMeSet?.has(starterIdStr);
      const canSee =
        !isBlocked &&
        canViewSync(
          c.startedBy.profilePhotoVisibility ?? "everyone",
          starterIdStr,
          meId,
          inContacts,
        );
      avatarUrl = canSee ? c.startedBy.avatar?.url || "" : "";
    }
  }

  return {
    id: c._id,
    groupId: sid(c.groupId),
    type: c.type,
    status: c.status,
    duration: c.duration,
    startedAt: c.startedAt,
    endedAt: c.endedAt,
    participantCount: c.participants?.length || 0,
    maxParticipants: c.maxParticipants,
    startedByMe: isStartedByMe,
    startedBy: c.startedBy?._id
      ? {
          id: sid(c.startedBy),
          fullName: c.startedBy.fullName,
          avatar: avatarUrl,
        }
      : { id: sid(c.startedBy) },
  };
};

export const getGroupCallHistoryList = async ({ group, member, me, limit }) => {
  const calls = await GroupCall.find({
    groupId: group._id,
    startedAt: { $gte: member.joinedAt },
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("startedBy", "fullName avatar profilePhotoVisibility");

  const starterIds = [
    ...new Set(
      calls
        .map((c) => (c.startedBy?._id ? String(c.startedBy._id) : sid(c.startedBy)))
        .filter((id) => id && id !== String(me)),
    ),
  ];

  const [savedContacts, blockers, meDoc] = await Promise.all([
    Contact.find({ ownerId: { $in: starterIds }, contactId: me }).select("ownerId").lean(),
    User.find({ _id: { $in: starterIds }, blockedUsers: me }).select("_id").lean(),
    User.findById(me).select("blockedUsers").lean(),
  ]);

  const targetSavedMeSet = new Set(savedContacts.map((c) => String(c.ownerId)));
  const blockedSet = new Set([
    ...blockers.map((b) => String(b._id)),
    ...(meDoc?.blockedUsers || []).map(String),
  ]);

  return calls.map((c) => formatGroupCall(c, me, targetSavedMeSet, blockedSet));
};

export const getMyGroupCallsList = async ({ me, limit }) => {
  const groups = await Group.find({ "members.userId": me })
    .select("name avatar members.userId members.joinedAt")
    .lean();

  const byId = new Map(
    groups.map((g) => {
      const mine = g.members.find((m) => sid(m.userId) === String(me));
      return [
        sid(g._id),
        {
          name: g.name,
          avatar: g.avatar?.url || "",
          joinedAt: mine?.joinedAt,
        },
      ];
    }),
  );

  const calls = await GroupCall.find({ groupId: { $in: [...byId.keys()] } })
    .sort({ createdAt: -1 })
    .limit(limit * 2)
    .populate("startedBy", "fullName avatar profilePhotoVisibility");

  const starterIds = [
    ...new Set(
      calls
        .map((c) => (c.startedBy?._id ? String(c.startedBy._id) : sid(c.startedBy)))
        .filter((id) => id && id !== String(me)),
    ),
  ];

  const [savedContacts, blockers, meDoc] = await Promise.all([
    Contact.find({ ownerId: { $in: starterIds }, contactId: me }).select("ownerId").lean(),
    User.find({ _id: { $in: starterIds }, blockedUsers: me }).select("_id").lean(),
    User.findById(me).select("blockedUsers").lean(),
  ]);

  const targetSavedMeSet = new Set(savedContacts.map((c) => String(c.ownerId)));
  const blockedSet = new Set([
    ...blockers.map((b) => String(b._id)),
    ...(meDoc?.blockedUsers || []).map(String),
  ]);

  return calls
    .filter((c) => {
      const g = byId.get(sid(c.groupId));
      return g && (!g.joinedAt || c.startedAt >= g.joinedAt);
    })
    .slice(0, limit)
    .map((c) => ({
      ...formatGroupCall(c, me, targetSavedMeSet, blockedSet),
      group: { id: sid(c.groupId), ...byId.get(sid(c.groupId)) },
    }));
};
