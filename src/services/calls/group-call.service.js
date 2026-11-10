import crypto from "crypto";
import * as groupRepository from "../../repositories/groups/group.repository.js";
import * as groupCallRepository from "../../repositories/groups/group-call.repository.js";
import * as userRepository from "../../repositories/users/user.repository.js";
import * as contactRepository from "../../repositories/contact.repository.js";
const sid = (x) => String(x?._id ?? x);
import { canViewSync } from "../privacy/privacy-visibility.service.js";
import { CALL_LIMITS } from "../../constants/call.constants.js";
import { getGroupAndMember } from "../../utils/group-guard.js";

export const formatGroupCall = (c, meId, targetSavedMeSet, blockedSet) => {
  const isStartedByMe = sid(c.startedBy) === String(meId);
  let starterAvatarUrl = "";

  if (c.startedBy?._id) {
    if (isStartedByMe) {
      starterAvatarUrl = c.startedBy.avatar?.url || "";
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
      starterAvatarUrl = canSee ? c.startedBy.avatar?.url || "" : "";
    }
  }

  const formattedParticipants = Array.isArray(c.participants)
    ? c.participants.map((p) => {
        if (!p) return null;
        const pIdStr = sid(p._id || p);
        const isMe = pIdStr === String(meId);
        const isBlocked = blockedSet?.has(pIdStr);
        const inContacts = targetSavedMeSet?.has(pIdStr);
        const canSee =
          isMe ||
          (!isBlocked &&
            canViewSync(
              p.profilePhotoVisibility ?? "everyone",
              pIdStr,
              meId,
              inContacts,
            ));
        return {
          id: pIdStr,
          fullName: p.fullName || "User",
          avatar: canSee ? p.avatar?.url || "" : "",
        };
      }).filter(Boolean)
    : [];

  return {
    id: c._id,
    groupId: sid(c.groupId),
    type: c.type,
    status: c.status,
    duration: Math.max(0, c.duration || 0),
    startedAt: c.startedAt,
    endedAt: c.endedAt || null,
    participantCount: c.participants?.length || 0,
    maxParticipants: c.maxParticipants || 1,
    startedByMe: isStartedByMe,
    startedBy: c.startedBy?._id
      ? {
          id: sid(c.startedBy),
          fullName: c.startedBy.fullName,
          avatar: starterAvatarUrl,
        }
      : { id: sid(c.startedBy) },
    participants: formattedParticipants,
  };
};

export const getGroupCallHistoryList = async ({
  group,
  member,
  me,
  limit = 50,
  page = 1,
}) => {
  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || CALL_LIMITS.DEFAULT_PAGE_LIMIT, CALL_LIMITS.MAX_PAGE_LIMIT),
  );
  const safePage = Math.max(1, Number(page) || 1);
  const skip = (safePage - 1) * safeLimit;

  const calls = await groupCallRepository.findForGroupAfter(
    group._id,
    member.joinedAt,
    { skip, limit: safeLimit },
  );

  const relatedUserIds = new Set();
  for (const c of calls) {
    const sId = c.startedBy?._id ? String(c.startedBy._id) : sid(c.startedBy);
    if (sId && sId !== String(me)) relatedUserIds.add(sId);
    if (Array.isArray(c.participants)) {
      for (const p of c.participants) {
        const pId = p?._id ? String(p._id) : sid(p);
        if (pId && pId !== String(me)) relatedUserIds.add(pId);
      }
    }
  }

  const userIdsArray = [...relatedUserIds];
  const [savedContacts, blockers, meDoc] = await Promise.all([
    contactRepository
      .find({ ownerId: { $in: userIdsArray }, contactId: me })
      .select("ownerId")
      .lean(),
    userRepository.findBlockersOf(userIdsArray, me),
    userRepository.findByIdLeanSelect(me, "blockedUsers"),
  ]);

  const targetSavedMeSet = new Set(savedContacts.map((c) => String(c.ownerId)));
  const blockedSet = new Set([
    ...blockers.map((b) => String(b._id)),
    ...(meDoc?.blockedUsers || []).map(String),
  ]);

  return calls.map((c) => formatGroupCall(c, me, targetSavedMeSet, blockedSet));
};

export const getMyGroupCallsList = async ({ me, limit = 50, page = 1 }) => {
  const safeLimit = Math.max(
    1,
    Math.min(Number(limit) || CALL_LIMITS.DEFAULT_PAGE_LIMIT, CALL_LIMITS.MAX_PAGE_LIMIT),
  );
  const safePage = Math.max(1, Number(page) || 1);
  const skip = (safePage - 1) * safeLimit;

  const groups = await groupRepository.findByMemberLean(
    me,
    "name avatar members.userId members.joinedAt",
  );

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

  const groupIds = [...byId.keys()];
  const calls = await groupCallRepository.findByGroupIds(groupIds, {
    skip,
    limit: safeLimit,
  });

  const relatedUserIds = new Set();
  for (const c of calls) {
    const sId = c.startedBy?._id ? String(c.startedBy._id) : sid(c.startedBy);
    if (sId && sId !== String(me)) relatedUserIds.add(sId);
    if (Array.isArray(c.participants)) {
      for (const p of c.participants) {
        const pId = p?._id ? String(p._id) : sid(p);
        if (pId && pId !== String(me)) relatedUserIds.add(pId);
      }
    }
  }

  const userIdsArray = [...relatedUserIds];
  const [savedContacts, blockers, meDoc] = await Promise.all([
    contactRepository
      .find({ ownerId: { $in: userIdsArray }, contactId: me })
      .select("ownerId")
      .lean(),
    userRepository.findBlockersOf(userIdsArray, me),
    userRepository.findByIdLeanSelect(me, "blockedUsers"),
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
    .map((c) => ({
      ...formatGroupCall(c, me, targetSavedMeSet, blockedSet),
      group: { id: sid(c.groupId), ...byId.get(sid(c.groupId)) },
    }));
};

export const createGroupCallRecord = async ({
  callId,
  groupId,
  startedBy,
  type,
  status,
  startedAt,
  endedAt,
  duration = 0,
  participants = [],
  maxParticipants = 1,
}) => {
  const uniqueParticipants = [...new Set(participants.map(String))];
  const finalCallId = callId || crypto.randomUUID();

  try {
    return await groupCallRepository.upsertByCallId(finalCallId, {
      callId: finalCallId,
      groupId,
      startedBy,
      type,
      status,
      startedAt: startedAt || new Date(),
      endedAt: endedAt || new Date(),
      duration: Math.max(0, Math.round(duration)),
      participants: uniqueParticipants,
      maxParticipants: Math.max(1, maxParticipants),
    });
  } catch (err) {
    if (err.code === 11000) {
      return groupCallRepository.findByCallId(finalCallId);
    }
    throw err;
  }
};

export const getGroupCallHistoryForRequest = async ({
  groupId,
  me,
  limit,
  page,
}) => {
  const { group, member } = await getGroupAndMember(groupId, me);
  return getGroupCallHistoryList({ group, member, me, limit, page });
};

const groupCallService = {
  formatGroupCall,
  getGroupCallHistoryList,
  getMyGroupCallsList,
  createGroupCallRecord,
  getGroupCallHistoryForRequest,
};

export default groupCallService;

