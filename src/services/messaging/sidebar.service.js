import User from "../../models/users.model.js";
import Message from "../../models/message.model.js";
import Contact from "../../models/contact.model.js";
import { getArchivedSet } from "../../models/chat-archive.model.js";
import { assertValidId, escapeRegex } from "../../utils/validators.js";
import {
  toObjectId,
  notExpired,
  formatMessage,
} from "../../utils/message-helpers.js";
import { canViewSync } from "../privacy-visibility.service.js";

export const getUsersForSidebar = async (userId, query = {}) => {
  assertValidId(userId, "User ID");

  const uid = toObjectId(userId);
  const search = String(query.search || query.q || "").trim();
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(Math.max(1, Number(query.limit) || 50), 100);

  const [me, archivedSet] = await Promise.all([
    User.findById(userId).select("blockedUsers").lean(),
    getArchivedSet(userId),
  ]);

  const myBlockedSet = new Set((me?.blockedUsers || []).map(String));

  const convoAgg = await Message.aggregate([
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
    const matchedUsers = await User.find({
      _id: { $ne: userId, $nin: [...myBlockedSet] },
      blockedUsers: { $ne: userId },
      $or: [{ fullName: rx }, { username: rx }, { email: rx }],
    })
      .select("_id")
      .limit(limit)
      .lean();

    targetUserIds = matchedUsers.map((u) => u._id.toString());
  } else {
    const contacts = await Contact.find({ ownerId: userId })
      .select("contactId")
      .lean();
    const contactUserIds = contacts.map((c) => c.contactId.toString());

    const combinedSet = new Set([...convoUserIds, ...contactUserIds]);

    if (combinedSet.size === 0) {
      const discoverUsers = await User.find({
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
    User.find({ _id: { $in: targetUserIds } })
      .select(
        "fullName email avatar bio lastSeen showOnlineStatus onlineStatusVisibility lastSeenVisibility profilePhotoVisibility aboutVisibility +publicKey",
      )
      .lean(),
    User.find({ _id: { $in: targetUserIds }, blockedUsers: userId })
      .select("_id")
      .lean(),
    Contact.find({ ownerId: { $in: targetUserIds }, contactId: userId })
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

      const canSee = (visibility, fallback) =>
        !isBlockedEither &&
        canViewSync(visibility ?? fallback, otherId, userId, targetSavedMeSet);

      const showPhoto = canSee(user.profilePhotoVisibility, "everyone");
      const showLastSeen = canSee(user.lastSeenVisibility, "contacts");
      const showAbout = canSee(user.aboutVisibility, "contacts");
      const onlineVis =
        user.showOnlineStatus === false
          ? "nobody"
          : (user.onlineStatusVisibility ?? "everyone");
      const showOnline = canSee(onlineVis, "everyone");

      return {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        avatar: showPhoto ? user.avatar?.url || "" : "",
        bio: showAbout ? user.bio || "" : "",
        lastSeen: showLastSeen ? user.lastSeen || null : null,
        showOnlineStatus: showOnline,
        isBlocked: isBlockedByMe,
        isArchived: archivedSet.has(otherId),
        hasPublicKey: Boolean(user.publicKey),
        unreadCount: isBlockedEither ? 0 : c?.unreadCount || 0,
        lastMessage: c ? formatMessage(c.lastMessage) : null,
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
