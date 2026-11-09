import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import Contact from "../models/contact.model.js";
import User from "../models/users.model.js";
import Message from "../models/message.model.js";
import { filterUsersForViewer } from "./privacy-visibility.service.js";
import { refreshPrivacy, io } from "../lib/socket.js";

const toObjectId = (id) =>
  id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id);

const isValidObjectId = (id) =>
  id && mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);

const sanitizeNickname = (nickname) => {
  if (typeof nickname !== "string") return undefined;
  const trimmed = nickname.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 50) : undefined;
};

/**
 * 1. Add contact
 * Validates target user, disallows self-contact, upserts contact document,
 * handles duplicate keys gracefully, synchronizes privacy and emits socket event.
 */
export const addContact = async (ownerId, contactId, nickname) => {
  if (!isValidObjectId(contactId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }
  if (String(ownerId) === String(contactId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "You can't add yourself.");
  }

  const targetUser = await User.findById(contactId).select("_id status").lean();
  if (!targetUser || targetUser.status === "suspended") {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const cleanNickname = sanitizeNickname(nickname);

  const updateOp =
    cleanNickname !== undefined
      ? { $set: { nickname: cleanNickname } }
      : { $setOnInsert: { nickname: undefined } };

  try {
    await Contact.updateOne(
      { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
      updateOp,
      { upsert: true },
    );
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  try {
    await Promise.all([
      refreshPrivacy(ownerId),
      refreshPrivacy(contactId),
    ]);
  } catch (e) {
    console.error("[contact.service] refreshPrivacy error:", e?.message || e);
  }

  io.to(String(ownerId)).emit("contact:added", {
    contactId: String(contactId),
    nickname: cleanNickname,
  });

  return {
    contactId: String(contactId),
    nickname: cleanNickname,
    isContact: true,
  };
};

/**
 * 2. Remove contact
 * Deletes directional contact link, synchronizes privacy and emits socket event.
 */
export const removeContact = async (ownerId, contactId) => {
  if (!isValidObjectId(contactId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }

  const result = await Contact.deleteOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  });

  if (result.deletedCount > 0) {
    try {
      await Promise.all([
        refreshPrivacy(ownerId),
        refreshPrivacy(contactId),
      ]);
    } catch (e) {
      console.error("[contact.service] refreshPrivacy error:", e?.message || e);
    }

    io.to(String(ownerId)).emit("contact:removed", {
      contactId: String(contactId),
    });
  }

  return {
    contactId: String(contactId),
    isContact: false,
  };
};

/**
 * 3. Get contacts list
 * Returns contact documents with populated user information, respects privacy visibility,
 * and supports optional pagination and search filters.
 */
export const getContacts = async (
  ownerId,
  { page, limit, search } = {},
) => {
  const isPaginated = page !== undefined || limit !== undefined;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const filter = { ownerId: toObjectId(ownerId) };

  let query = Contact.find(filter)
    .populate(
      "contactId",
      "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility status",
    )
    .sort({ createdAt: -1 });

  if (isPaginated && !search) {
    query = query.skip(skip).limit(limitNum);
  }

  const rows = await query.lean();

  const validRows = rows.filter(
    (r) => r.contactId && r.contactId.status !== "suspended",
  );
  const populatedUsers = validRows.map((r) => r.contactId);
  const safeUsers = await filterUsersForViewer(populatedUsers, ownerId);
  const safeMap = new Map(safeUsers.map((u) => [String(u._id || u.id), u]));

  let contacts = validRows.map((r) => {
    const uId = String(r.contactId._id || r.contactId.id);
    const safe = safeMap.get(uId);
    return {
      ...(safe || r.contactId),
      nickname: r.nickname,
      createdAt: r.createdAt,
    };
  });

  let total;

  if (search && typeof search === "string" && search.trim().length > 0) {
    const term = search.trim().toLowerCase();
    contacts = contacts.filter(
      (c) =>
        (c.nickname && c.nickname.toLowerCase().includes(term)) ||
        (c.fullName && c.fullName.toLowerCase().includes(term)) ||
        (c.username && c.username.toLowerCase().includes(term)),
    );
    total = contacts.length;
    if (isPaginated) {
      contacts = contacts.slice(skip, skip + limitNum);
    }
  } else if (isPaginated) {
    total = await Contact.countDocuments(filter);
  } else {
    total = contacts.length;
  }

  return {
    contacts,
    ...(isPaginated ? { total, page: pageNum, limit: limitNum } : {}),
  };
};

/**
 * 4. Get contact by ID
 * Fetches a single contact for the owner and returns privacy-filtered user information.
 */
export const getContactById = async (ownerId, contactId) => {
  if (!isValidObjectId(contactId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }

  const row = await Contact.findOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  })
    .populate(
      "contactId",
      "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility status",
    )
    .lean();

  if (!row || !row.contactId || row.contactId.status === "suspended") {
    throw new ApiError(StatusCodes.NOT_FOUND, "Contact not found.");
  }

  const [safeUser] = await filterUsersForViewer([row.contactId], ownerId);

  return {
    ...(safeUser || row.contactId),
    nickname: row.nickname,
    createdAt: row.createdAt,
  };
};

/**
 * 5. Update contact nickname
 * Updates or clears the custom nickname for an existing contact.
 */
export const updateContactNickname = async (ownerId, contactId, nickname) => {
  if (!isValidObjectId(contactId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }

  const cleanNickname = sanitizeNickname(nickname);

  const updateOp = cleanNickname
    ? { $set: { nickname: cleanNickname } }
    : { $unset: { nickname: 1 } };

  const updated = await Contact.findOneAndUpdate(
    { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
    updateOp,
    { new: true },
  ).lean();

  if (!updated) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Contact not found.");
  }

  const finalNickname = updated.nickname || null;

  io.to(String(ownerId)).emit("contact:updated", {
    contactId: String(contactId),
    nickname: finalNickname,
  });

  return {
    contactId: String(contactId),
    nickname: finalNickname,
  };
};

/**
 * 6. Directional contact check
 * Returns true if ownerId has saved contactId in their contacts.
 */
export const isContact = async (ownerId, contactId) => {
  if (
    !isValidObjectId(ownerId) ||
    !isValidObjectId(contactId) ||
    String(ownerId) === String(contactId)
  ) {
    return false;
  }
  return Boolean(
    await Contact.exists({
      ownerId: toObjectId(ownerId),
      contactId: toObjectId(contactId),
    }),
  );
};

/**
 * 7. Mutual contact check
 * Returns true if both users have saved each other as contacts.
 */
export const isMutualContact = async (userA, userB) => {
  if (
    !isValidObjectId(userA) ||
    !isValidObjectId(userB) ||
    String(userA) === String(userB)
  ) {
    return false;
  }
  const count = await Contact.countDocuments({
    $or: [
      { ownerId: toObjectId(userA), contactId: toObjectId(userB) },
      { ownerId: toObjectId(userB), contactId: toObjectId(userA) },
    ],
  });
  return count === 2;
};

/**
 * 8. Get mutual contacts
 * Finds all contacts common to both users.
 */
export const getMutualContacts = async (userId, otherUserId) => {
  if (!isValidObjectId(userId) || !isValidObjectId(otherUserId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }
  if (String(userId) === String(otherUserId)) {
    return [];
  }

  const otherUser = await User.findById(otherUserId)
    .select("_id status")
    .lean();
  if (!otherUser || otherUser.status === "suspended") {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  const [contactsA, contactsB] = await Promise.all([
    Contact.find({ ownerId: toObjectId(userId) }).select("contactId").lean(),
    Contact.find({ ownerId: toObjectId(otherUserId) }).select("contactId").lean(),
  ]);

  const setA = new Set(contactsA.map((c) => String(c.contactId)));
  const mutualIds = contactsB
    .map((c) => String(c.contactId))
    .filter((id) => setA.has(id));

  if (!mutualIds.length) return [];

  const users = await User.find({
    _id: { $in: mutualIds.map(toObjectId) },
    status: { $ne: "suspended" },
  })
    .select(
      "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility",
    )
    .lean();

  return await filterUsersForViewer(users, userId);
};

/**
 * 9. Check contact exists
 * Fast check for contact existence.
 */
export const checkContactExists = async (ownerId, contactId) => {
  return await isContact(ownerId, contactId);
};

/**
 * 10. Search within contacts
 * Searches exclusively through ownerId's saved contacts.
 */
export const searchContacts = async (
  ownerId,
  searchQuery,
  { limit = 20 } = {},
) => {
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const term = String(searchQuery || "").trim();
  if (!term) return [];

  const rows = await Contact.find({ ownerId: toObjectId(ownerId) })
    .populate(
      "contactId",
      "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility status",
    )
    .lean();

  const regex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const matched = rows.filter((r) => {
    if (!r.contactId || r.contactId.status === "suspended") return false;
    return (
      (r.nickname && regex.test(r.nickname)) ||
      regex.test(r.contactId.fullName || "") ||
      regex.test(r.contactId.username || "")
    );
  });

  const sliced = matched.slice(0, limitNum);
  const safeUsers = await filterUsersForViewer(
    sliced.map((r) => r.contactId),
    ownerId,
  );
  const safeMap = new Map(safeUsers.map((u) => [String(u._id || u.id), u]));

  return sliced.map((r) => {
    const uId = String(r.contactId._id || r.contactId.id);
    const safe = safeMap.get(uId);
    return {
      ...(safe || r.contactId),
      nickname: r.nickname,
      createdAt: r.createdAt,
    };
  });
};

/**
 * 11. Get contact count
 * Returns the count of contacts saved by the owner.
 */
export const getContactCount = async (ownerId) => {
  const count = await Contact.countDocuments({ ownerId: toObjectId(ownerId) });
  return { totalContacts: count, count };
};

/**
 * 12. Bulk add contacts
 * Adds up to 100 contacts in a single operation using bulkWrite.
 */
export const bulkAddContacts = async (ownerId, contactIds) => {
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "contactIds must be a non-empty array.",
    );
  }
  if (contactIds.length > 100) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Cannot add more than 100 contacts at once.",
    );
  }

  const ownerStr = String(ownerId);
  const validTargetIds = Array.from(
    new Set(
      contactIds
        .filter(
          (id) =>
            isValidObjectId(id) && String(id) !== ownerStr,
        )
        .map(String),
    ),
  );

  if (!validTargetIds.length) {
    return {
      addedCount: 0,
      skippedCount: contactIds.length,
      totalProcessed: 0,
    };
  }

  const existingUsers = await User.find({
    _id: { $in: validTargetIds.map(toObjectId) },
    status: { $ne: "suspended" },
  })
    .select("_id")
    .lean();

  const existingUserIds = existingUsers.map((u) => String(u._id));
  if (!existingUserIds.length) {
    return {
      addedCount: 0,
      skippedCount: contactIds.length,
      totalProcessed: 0,
    };
  }

  const operations = existingUserIds.map((cId) => ({
    updateOne: {
      filter: { ownerId: toObjectId(ownerId), contactId: toObjectId(cId) },
      update: { $setOnInsert: { nickname: undefined } },
      upsert: true,
    },
  }));

  const result = await Contact.bulkWrite(operations, { ordered: false });
  const addedCount = result.upsertedCount || 0;

  try {
    await Promise.all([
      refreshPrivacy(ownerId),
      ...existingUserIds.map((cId) => refreshPrivacy(cId).catch(() => {})),
    ]);
  } catch (e) {
    console.error("[contact.service] refreshPrivacy error:", e?.message || e);
  }

  io.to(String(ownerId)).emit("contacts:bulk-added", {
    contactIds: existingUserIds,
    addedCount,
  });

  return {
    addedCount,
    skippedCount: contactIds.length - addedCount,
    totalProcessed: existingUserIds.length,
  };
};

/**
 * 13. Validate contact ownership
 * Ensures contact exists and belongs to the owner.
 */
export const validateContactOwnership = async (ownerId, contactId) => {
  if (!isValidObjectId(contactId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
  }
  const contact = await Contact.findOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  }).lean();

  if (!contact) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Contact not found.");
  }
  return contact;
};

/**
 * 14. Search discoverable users (Existing endpoint support: GET /contacts/search)
 * Finds users matching query (name, username, email), excludes blocked users,
 * checks contact status, and sanitizes via privacy viewer filter.
 */
export const searchUsers = async (currentUserId, rawQuery) => {
  const q = String(rawQuery || "").trim();
  if (q.length < 2) {
    return { users: [], message: "Type at least 2 characters." };
  }

  const me = await User.findById(currentUserId).select("blockedUsers").lean();
  const myBlocked = me?.blockedUsers || [];
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const users = await User.find({
    _id: { $ne: toObjectId(currentUserId), $nin: myBlocked },
    blockedUsers: { $ne: toObjectId(currentUserId) },
    status: { $ne: "suspended" },
    $or: [{ fullName: rx }, { username: rx }, { email: rx }],
  })
    .select(
      "fullName username avatar bio profilePhotoVisibility aboutVisibility",
    )
    .limit(20)
    .lean();

  const mine = await Contact.find({
    ownerId: toObjectId(currentUserId),
    contactId: { $in: users.map((u) => u._id) },
  }).select("contactId");
  const set = new Set(mine.map((c) => String(c.contactId)));

  const safeUsers = await filterUsersForViewer(users, currentUserId);

  const resultUsers = safeUsers.map((u) => ({
    ...u,
    isContact: set.has(String(u._id || u.id)),
  }));

  return { users: resultUsers, message: "Users fetched successfully." };
};

/**
 * 15. Get contact chat list (Existing endpoint support: GET /contacts/chats)
 * Aggregates latest messages and unread counts for all contacts.
 */
export const getChatList = async (currentUserId) => {
  const me = toObjectId(currentUserId);
  const contacts = await Contact.find({ ownerId: me })
    .select("contactId")
    .lean();
  const ids = contacts.map((c) => c.contactId);

  const last = await Message.aggregate([
    {
      $match: {
        deletedFor: { $ne: me },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        $and: [
          {
            $or: [
              { senderId: me, receiverId: { $in: ids } },
              { receiverId: me, senderId: { $in: ids } },
            ],
          },
        ],
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: {
          $cond: [{ $eq: ["$senderId", me] }, "$receiverId", "$senderId"],
        },
        lastMessage: { $first: "$$ROOT" },
        unread: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$receiverId", me] },
                  { $ne: ["$status", "seen"] },
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  const byUser = new Map(last.map((l) => [String(l._id), l]));

  const users = await User.find({ _id: { $in: ids }, status: { $ne: "suspended" } })
    .select(
      "fullName username avatar lastSeen showOnlineStatus onlineStatusVisibility bio lastSeenVisibility profilePhotoVisibility aboutVisibility",
    )
    .lean();

  const safeUsers = await filterUsersForViewer(users, me);
  const safeUserMap = new Map(
    safeUsers.map((u) => [String(u._id || u.id), u]),
  );

  const chats = users
    .map((u) => {
      const uid = String(u._id);
      const l = byUser.get(uid);
      const safe = safeUserMap.get(uid) || u;
      return {
        user: safe,
        lastMessage: l?.lastMessage || null,
        unread: l?.unread || 0,
      };
    })
    .sort(
      (a, b) =>
        new Date(b.lastMessage?.createdAt || 0) -
        new Date(a.lastMessage?.createdAt || 0),
    );

  return { chats, totalContacts: ids.length };
};
