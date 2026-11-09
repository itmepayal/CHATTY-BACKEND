import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import {
  assertValidObjectId,
  isValidObjectId,
} from "../utils/object-id.util.js";
import {
  sanitizeNickname,
  parsePagination,
  escapeRegex,
} from "../utils/sanitize.util.js";
import {
  MAX_BULK_CONTACTS,
  SEARCH_MIN_LENGTH,
  SEARCH_RESULT_LIMIT,
  USER_STATUS,
  CONTACT_ERROR_MESSAGES,
  CONTACT_SUCCESS_MESSAGES,
} from "../constants/contact.constants.js";
import { CHAT_LIST_USER_FIELDS } from "../constants/user-fields.constants.js";
import * as contactRepo from "../repositories/contact.repository.js";
import * as contactEvents from "../events/contact.events.js";
import { filterUsersForViewer } from "./privacy-visibility.service.js";

export const addContact = async (ownerId, contactId, nickname) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(contactId, CONTACT_ERROR_MESSAGES.INVALID_USER_ID);

  if (String(ownerId) === String(contactId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.CANNOT_ADD_SELF,
    );
  }

  const targetUser = await contactRepo.findUserById(contactId);
  if (!targetUser || targetUser.status === USER_STATUS.SUSPENDED) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  const isBlocked = await contactRepo.isBlockedBidirectional(
    ownerId,
    contactId,
  );
  if (isBlocked) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      CONTACT_ERROR_MESSAGES.CANNOT_ADD_BLOCKED,
    );
  }

  const cleanNickname = sanitizeNickname(nickname);

  try {
    await contactRepo.upsertContact(ownerId, contactId, cleanNickname);
  } catch (err) {
    if (err.code !== 11000) throw err;
  }

  await contactEvents.syncPrivacy([ownerId, contactId]);
  contactEvents.emitContactAdded(ownerId, {
    contactId: String(contactId),
    nickname: cleanNickname,
  });

  return {
    contactId: String(contactId),
    nickname: cleanNickname,
    isContact: true,
  };
};

export const removeContact = async (ownerId, contactId) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(contactId, CONTACT_ERROR_MESSAGES.INVALID_USER_ID);

  const result = await contactRepo.deleteContact(ownerId, contactId);

  if (result.deletedCount > 0) {
    await contactEvents.syncPrivacy([ownerId, contactId]);
    contactEvents.emitContactRemoved(ownerId, { contactId: String(contactId) });
  }

  return {
    contactId: String(contactId),
    isContact: false,
  };
};

export const getContacts = async (ownerId, query = {}) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);

  const { isPaginated, pageNum, limitNum, skip, search } =
    parsePagination(query);

  const { rows, total } = await contactRepo.findContactsAggregation(ownerId, {
    skip,
    limitNum,
    isPaginated,
    search,
  });

  const rawUsers = rows.map((r) => r.user);
  const safeUsers = await filterUsersForViewer(rawUsers, ownerId);
  const safeMap = new Map(safeUsers.map((u) => [String(u._id || u.id), u]));

  const contacts = [];
  for (const r of rows) {
    const uId = String(r.user._id);
    const safe = safeMap.get(uId);
    if (!safe) continue;
    contacts.push({
      ...safe,
      nickname: r.nickname,
      createdAt: r.createdAt,
    });
  }

  return {
    contacts,
    ...(isPaginated ? { total, page: pageNum, limit: limitNum } : {}),
  };
};

export const getContactById = async (ownerId, contactId) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(contactId, CONTACT_ERROR_MESSAGES.INVALID_USER_ID);

  const row = await contactRepo.findContactWithUser(ownerId, contactId);
  if (
    !row ||
    !row.contactId ||
    row.contactId.status === USER_STATUS.SUSPENDED
  ) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.CONTACT_NOT_FOUND,
    );
  }

  const [safeUser] = await filterUsersForViewer([row.contactId], ownerId);
  if (!safeUser) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.CONTACT_NOT_FOUND,
    );
  }

  return {
    ...safeUser,
    nickname: row.nickname,
    createdAt: row.createdAt,
  };
};

export const updateContactNickname = async (ownerId, contactId, nickname) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(contactId, CONTACT_ERROR_MESSAGES.INVALID_USER_ID);

  const cleanNickname = sanitizeNickname(nickname);
  const updated = await contactRepo.updateNickname(
    ownerId,
    contactId,
    cleanNickname,
  );

  if (!updated) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.CONTACT_NOT_FOUND,
    );
  }

  const finalNickname = updated.nickname || null;
  contactEvents.emitContactUpdated(ownerId, {
    contactId: String(contactId),
    nickname: finalNickname,
  });

  return {
    contactId: String(contactId),
    nickname: finalNickname,
  };
};

export const isContact = async (ownerId, contactId) => {
  if (
    !isValidObjectId(ownerId) ||
    !isValidObjectId(contactId) ||
    String(ownerId) === String(contactId)
  ) {
    return false;
  }
  return contactRepo.existsContact(ownerId, contactId);
};

export const isMutualContact = async (userA, userB) => {
  if (
    !isValidObjectId(userA) ||
    !isValidObjectId(userB) ||
    String(userA) === String(userB)
  ) {
    return false;
  }
  const [aHasB, bHasA] = await Promise.all([
    contactRepo.existsContact(userA, userB),
    contactRepo.existsContact(userB, userA),
  ]);
  return Boolean(aHasB && bHasA);
};

export const getMutualContacts = async (userId, otherUserId) => {
  assertValidObjectId(userId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(otherUserId, CONTACT_ERROR_MESSAGES.INVALID_USER_ID);

  if (String(userId) === String(otherUserId)) return [];

  const otherUser = await contactRepo.findUserById(otherUserId);
  if (!otherUser || otherUser.status === USER_STATUS.SUSPENDED) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  const mutualIds = await contactRepo.findMutualContactIds(userId, otherUserId);
  if (!mutualIds.length) return [];

  const users = await contactRepo.findUsersByIds(mutualIds);
  return filterUsersForViewer(users, userId);
};

export const checkContactExists = async (ownerId, contactId) =>
  isContact(ownerId, contactId);

export const searchContacts = async (
  ownerId,
  searchQuery,
  { limit = SEARCH_RESULT_LIMIT } = {},
) => {
  const term = String(searchQuery || "").trim();
  if (!term) return [];

  const result = await getContacts(ownerId, {
    page: 1,
    limit,
    search: term,
  });

  return result.contacts;
};

export const getContactCount = async (ownerId) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  const count = await contactRepo.countContacts(ownerId);
  return { totalContacts: count, count };
};

export const bulkAddContacts = async (ownerId, contactIds) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);

  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.INVALID_BULK_ARRAY,
    );
  }
  if (contactIds.length > MAX_BULK_CONTACTS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.EXCEEDED_BULK_LIMIT,
    );
  }

  const ownerStr = String(ownerId);
  let invalidCount = 0;
  const rawValidIds = [];

  for (const id of contactIds) {
    if (!isValidObjectId(id) || String(id) === ownerStr) {
      invalidCount++;
    } else {
      rawValidIds.push(String(id));
    }
  }

  const uniqueCandidates = [...new Set(rawValidIds)];
  if (!uniqueCandidates.length) {
    return {
      addedCount: 0,
      alreadyExistsCount: 0,
      invalidCount,
      blockedCount: 0,
      totalProcessed: 0,
      skippedCount: invalidCount,
    };
  }

  const existingContactSet = await contactRepo.findExistingContactIdSet(
    ownerId,
    uniqueCandidates,
  );
  const alreadyExistsCount = uniqueCandidates.filter((id) =>
    existingContactSet.has(id),
  ).length;
  const toProcessIds = uniqueCandidates.filter(
    (id) => !existingContactSet.has(id),
  );

  const targetUsers = await contactRepo.findUsersWithBlocked(toProcessIds);
  const targetUserMap = new Map(targetUsers.map((u) => [String(u._id), u]));

  const missingCount = toProcessIds.filter(
    (id) => !targetUserMap.has(id),
  ).length;
  invalidCount += missingCount;

  const myBlockedList = new Set(await contactRepo.findUserBlockedList(ownerId));
  let blockedCount = 0;
  const eligibleIds = [];

  for (const id of toProcessIds) {
    const target = targetUserMap.get(id);
    if (!target) continue;

    const targetBlocked = new Set((target.blockedUsers || []).map(String));
    if (myBlockedList.has(id) || targetBlocked.has(ownerStr)) {
      blockedCount++;
    } else {
      eligibleIds.push(id);
    }
  }

  if (eligibleIds.length > 0) {
    await contactRepo.bulkUpsertContacts(ownerId, eligibleIds);
    await contactEvents.syncPrivacy([ownerId, ...eligibleIds]);
    contactEvents.emitContactsBulkAdded(ownerId, {
      contactIds: eligibleIds,
      addedCount: eligibleIds.length,
    });
  }

  const addedCount = eligibleIds.length;
  const skippedCount = invalidCount + alreadyExistsCount + blockedCount;

  return {
    addedCount,
    alreadyExistsCount,
    invalidCount,
    blockedCount,
    totalProcessed: addedCount,
    skippedCount,
  };
};

export const validateContactOwnership = async (ownerId, contactId) => {
  assertValidObjectId(ownerId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(contactId, CONTACT_ERROR_MESSAGES.INVALID_USER_ID);

  const contact = await contactRepo.findContact(ownerId, contactId);
  if (!contact) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.CONTACT_NOT_FOUND,
    );
  }
  return contact;
};

export const searchUsers = async (currentUserId, rawQuery) => {
  assertValidObjectId(currentUserId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);

  const q = String(rawQuery || "").trim();
  if (q.length < SEARCH_MIN_LENGTH) {
    return { users: [], message: CONTACT_ERROR_MESSAGES.SEARCH_MIN_LENGTH };
  }

  const blockedList = await contactRepo.findUserBlockedList(currentUserId);
  const nameOrUsernameRegex = new RegExp(escapeRegex(q), "i");
  const exactEmail = q.toLowerCase();

  const users = await contactRepo.searchDiscoverableUsers({
    currentUserId,
    blockedUserIds: blockedList,
    nameOrUsernameRegex,
    exactEmail,
    limit: SEARCH_RESULT_LIMIT,
  });

  const myContactIds = new Set(await contactRepo.findContactIds(currentUserId));
  const safeUsers = await filterUsersForViewer(users, currentUserId);

  const resultUsers = safeUsers.map((u) => ({
    ...u,
    isContact: myContactIds.has(String(u._id || u.id)),
  }));

  return {
    users: resultUsers,
    message: CONTACT_SUCCESS_MESSAGES.USERS_FETCHED,
  };
};

export const getChatList = async (currentUserId) => {
  assertValidObjectId(currentUserId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);

  const ids = await contactRepo.findContactIds(currentUserId);
  if (!ids.length) {
    return { chats: [], totalContacts: 0 };
  }

  const activeUsers = await contactRepo.findUsersByIds(
    ids,
    CHAT_LIST_USER_FIELDS,
  );
  if (!activeUsers.length) {
    return { chats: [], totalContacts: ids.length };
  }

  const activeContactIds = activeUsers.map((u) => String(u._id));
  const messagesByUser = await contactRepo.aggregateChatListMessages(
    currentUserId,
    activeContactIds,
  );

  const safeUsers = await filterUsersForViewer(activeUsers, currentUserId);
  const safeUserMap = new Map(safeUsers.map((u) => [String(u._id || u.id), u]));

  const chats = [];
  for (const u of activeUsers) {
    const uid = String(u._id);
    const safe = safeUserMap.get(uid);
    if (!safe) continue; // PRIVACY LEAK FIX

    const l = messagesByUser.get(uid);
    chats.push({
      user: safe,
      lastMessage: l?.lastMessage || null,
      unread: l?.unread || 0,
    });
  }

  chats.sort((a, b) => {
    const timeA = a.lastMessage?.createdAt
      ? new Date(a.lastMessage.createdAt).getTime()
      : 0;
    const timeB = b.lastMessage?.createdAt
      ? new Date(b.lastMessage.createdAt).getTime()
      : 0;
    if (timeB !== timeA) return timeB - timeA;
    return (a.user.fullName || "").localeCompare(b.user.fullName || "");
  });

  return { chats, totalContacts: ids.length };
};
