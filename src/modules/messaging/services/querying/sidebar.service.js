import * as userRepository from "../../../users/repositories/user.repository.js";
import * as messageRepository from "../../repositories/message.repository.js";
import * as contactRepository from "../../../contacts/repositories/contact.repository.js";
import { getArchivedSet } from "../../repositories/chat-setting.repository.js";
import {
  assertValidId,
  escapeRegex,
} from "../../../../shared/utils/validators.js";
import {
  toObjectId,
  notExpired,
  formatMessage,
} from "../../utils/message-helpers.js";
import { canViewSync } from "../../../privacy/services/privacy-visibility.service.js";
import { isUnlockTokenValid } from "../../../users/utils/lock-token.util.js";

export const getUsersForSidebar = async (userId, query = {}, options = {}) => {
  assertValidId(userId, "User ID");

  const uid = toObjectId(userId);
  const search = String(query.search || query.q || "").trim();
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(Math.max(1, Number(query.limit) || 50), 100);

  const [me, archivedSet] = await Promise.all([
    userRepository
      .findById(userId)
      .select("blockedUsers readReceipts lockedChats +lockEpoch")
      .lean(),
    getArchivedSet(userId),
  ]);

  const myBlockedSet = new Set((me?.blockedUsers || []).map(String));
  const myLockedSet = new Set((me?.lockedChats || []).map(String));

  let isAppUnlocked = false;
  if (options?.unlockToken && me) {
    if (
      isUnlockTokenValid(
        options.unlockToken,
        userId,
        options.sessionId,
        "app",
        me.lockEpoch,
      )
    ) {
      isAppUnlocked = true;
    }
  }

  const convoAgg = await messageRepository.aggregate([
    {
      $match: {
        $and: [{ $or: [{ senderId: uid }, { receiverId: uid }] }, notExpired()],
        deletedFor: { $ne: uid },
      },
    },
    {
      $addFields: {
        otherId: {
          $cond: [{ $eq: ["$senderId", uid] }, "$receiverId", "$senderId"],
        },
        isUnread: {
          $and: [
            { $eq: ["$receiverId", uid] },
            { $ne: ["$status", "seen"] },
            { $eq: [{ $ifNull: ["$receiverReadAt", null] }, null] },
            { $ne: ["$isDeleted", true] },
          ],
        },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: "$otherId",
        lastMessage: { $first: "$$ROOT" },
        unreadCount: { $sum: { $cond: ["$isUnread", 1, 0] } },
      },
    },
  ]);

  const convoMap = new Map(convoAgg.map((c) => [c._id.toString(), c]));
  const convoUserIds = convoAgg.map((c) => c._id.toString());

  let targetUserIds = [];

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    const matchedUsers = await userRepository
      .find({
        _id: { $ne: userId, $nin: [...myBlockedSet] },
        blockedUsers: { $ne: userId },
        $or: [{ fullName: rx }, { username: rx }, { email: rx }],
      })
      .select("_id")
      .limit(limit)
      .lean();

    targetUserIds = matchedUsers.map((u) => u._id.toString());
  } else {
    const contacts = await contactRepository
      .find({ ownerId: userId })
      .select("contactId")
      .lean();
    const contactUserIds = contacts.map((c) => c.contactId.toString());

    const combinedSet = new Set([...convoUserIds, ...contactUserIds]);

    if (combinedSet.size === 0) {
      const discoverUsers = await userRepository
        .find({
          _id: { $ne: userId, $nin: [...myBlockedSet] },
          blockedUsers: { $ne: userId },
        })
        .select("_id")
        .limit(limit)
        .lean();
      discoverUsers.forEach((u) => combinedSet.add(u._id.toString()));
    }

    const allTargetIds = Array.from(combinedSet);
    const skip = (page - 1) * limit;
    targetUserIds = allTargetIds.slice(skip, skip + limit);
  }

  if (!targetUserIds.length) {
    return {
      response: [],
      message: "Users fetched successfully.",
    };
  }

  const [users, blockers, contactsWhoSavedMe] = await Promise.all([
    userRepository
      .find({ _id: { $in: targetUserIds } })
      .select(
        "fullName email avatar bio lastSeen showOnlineStatus onlineStatusVisibility lastSeenVisibility profilePhotoVisibility aboutVisibility lastSeenExceptions profilePhotoExceptions aboutExceptions groupAddExceptions readReceipts typingIndicator +publicKey",
      )
      .lean(),
    userRepository
      .find({ _id: { $in: targetUserIds }, blockedUsers: userId })
      .select("_id")
      .lean(),
    contactRepository
      .find({ ownerId: { $in: targetUserIds }, contactId: userId })
      .select("ownerId")
      .lean(),
  ]);

  const blockerSet = new Set(blockers.map((b) => String(b._id)));
  const targetSavedMeSet = new Set(
    contactsWhoSavedMe.map((c) => String(c.ownerId)),
  );

  const ts = Date.now();
  const userMap = new Map(users.map((u) => [u._id.toString(), u]));

  const response = targetUserIds
    .map((otherId) => {
      const user = userMap.get(otherId);
      if (!user) return null;

      const c = convoMap.get(otherId);
      const isBlockedByMe = myBlockedSet.has(otherId);
      const isBlockedEither = isBlockedByMe || blockerSet.has(otherId);

      const canSee = (visibility, fallback, exceptions = []) =>
        !isBlockedEither &&
        canViewSync(
          visibility ?? fallback,
          otherId,
          userId,
          targetSavedMeSet,
          exceptions,
        );

      const showPhoto = canSee(
        user.profilePhotoVisibility,
        "everyone",
        user.profilePhotoExceptions,
      );
      const showLastSeen = canSee(
        user.lastSeenVisibility,
        "everyone",
        user.lastSeenExceptions,
      );
      const showAbout = canSee(
        user.aboutVisibility,
        "everyone",
        user.aboutExceptions,
      );

      let effectiveOnlineVis = user.onlineStatusVisibility ?? "everyone";
      let effectiveOnlineExceptions = user.lastSeenExceptions || [];
      if (effectiveOnlineVis === "same_as_last_seen") {
        effectiveOnlineVis = user.lastSeenVisibility ?? "everyone";
        effectiveOnlineExceptions = user.lastSeenExceptions || [];
      }
      if (user.showOnlineStatus === false) {
        effectiveOnlineVis = "nobody";
      }

      const showOnline = canSee(
        effectiveOnlineVis,
        "everyone",
        effectiveOnlineExceptions,
      );
      const canAddToGroup = canSee(
        user.groupAddPermission,
        "everyone",
        user.groupAddExceptions,
      );
      const canReceipt =
        !isBlockedEither &&
        me?.readReceipts !== false &&
        user.readReceipts !== false;

      const isChatLocked = myLockedSet.has(otherId);
      let isUnlocked = isAppUnlocked;
      if (isChatLocked && !isUnlocked && options?.unlockToken && me) {
        if (
          isUnlockTokenValid(
            options.unlockToken,
            userId,
            options.sessionId,
            otherId,
            me.lockEpoch,
          )
        ) {
          isUnlocked = true;
        }
      }

      let lastMsg = c?.lastMessage ? formatMessage(c.lastMessage) : null;
      if (lastMsg && !canReceipt && lastMsg.status === "seen") {
        lastMsg = { ...lastMsg, status: "delivered", seenAt: null };
      }

      if (isChatLocked && !isUnlocked && lastMsg) {
        lastMsg = {
          id: lastMsg.id || lastMsg._id,
          _id: lastMsg.id || lastMsg._id,
          senderId: lastMsg.senderId,
          receiverId: lastMsg.receiverId,
          isLocked: true,
          status: lastMsg.status,
          createdAt: lastMsg.createdAt,
          updatedAt: lastMsg.updatedAt,
        };
      }

      return {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        avatar: showPhoto ? user.avatar?.url || "" : "",
        bio: showAbout ? user.bio || "" : "",
        customStatus: showAbout ? user.customStatus || "" : "",
        lastSeen: showLastSeen ? user.lastSeen || null : null,
        showOnlineStatus: showOnline,
        readReceipts: canReceipt,
        typingIndicator: user.typingIndicator !== false,
        isAboutRestricted: !showAbout,
        isPhotoRestricted: !showPhoto,
        isLastSeenRestricted: !showLastSeen,
        isOnlineRestricted: !showOnline,
        canAddToGroup,
        isBlocked: isBlockedByMe,
        isLocked: isChatLocked,
        isArchived: archivedSet.has(otherId),
        hasPublicKey: Boolean(user.publicKey),
        unreadCount: isBlockedEither ? 0 : c?.unreadCount || 0,
        lastMessage: lastMsg,
        lastMessageAt: c?.lastMessage?.createdAt || null,
        ts,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });

  return {
    response,
    message: "Users fetched successfully.",
  };
};

const sidebarService = {
  getUsersForSidebar,
};

export default sidebarService;
