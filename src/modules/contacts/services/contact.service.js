import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import {
  assertValidObjectId,
  isValidObjectId,
} from "../../../shared/utils/object-id.util.js";
import {
  sanitizeNickname,
  parsePagination,
  escapeRegex,
} from "../../../shared/utils/sanitize.util.js";
import {
  MAX_BULK_CONTACTS,
  SEARCH_MIN_LENGTH,
  SEARCH_RESULT_LIMIT,
  USER_STATUS,
  CONTACT_ERROR_MESSAGES,
  CONTACT_SUCCESS_MESSAGES,
} from "../constants/contact.constants.js";
import { CHAT_LIST_USER_FIELDS } from "../../users/constants/user-fields.constants.js";
import * as contactRepo from "../repositories/contact.repository.js";
import * as contactRequestRepo from "../repositories/contact-request.repository.js";
import ContactRequest, { CONTACT_REQUEST_STATUS } from "../models/contact-request.model.js";
import * as contactEvents from "../events/contact.events.js";
import { filterUsersForViewer } from "../../privacy/services/privacy-visibility.service.js";
import * as notificationService from "../../notifications/services/notification.service.js";
import { NOTIFICATION_TYPES } from "../../notifications/models/notification.model.js";
import * as userRepository from "../../users/repositories/user.repository.js";

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

  const [res1, res2] = await Promise.all([
    contactRepo.deleteContact(ownerId, contactId),
    contactRepo.deleteContact(contactId, ownerId),
  ]);

  if (res1.deletedCount > 0 || res2.deletedCount > 0) {
    await contactEvents.syncPrivacy([ownerId, contactId]);
    contactEvents.emitContactRemoved(ownerId, { contactId: String(contactId) });
    contactEvents.emitContactRemoved(contactId, { contactId: String(ownerId) });

    try {
      const owner = await contactRepo.findUserById(ownerId, "fullName");
      await notificationService.sendNotification({
        userId: contactId,
        senderId: ownerId,
        type: NOTIFICATION_TYPES.CONTACT_REMOVED,
        title: "Contact Removed",
        body: `${owner?.fullName || "A contact"} removed you from contacts.`,
        data: { contactId: String(ownerId) },
      });
    } catch {}
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

  const validRows = rows.filter((r) => r?.contactDetails?._id);

  const safeUsers = await filterUsersForViewer(
    validRows.map((r) => r.contactDetails),
    ownerId,
  );
  const safeMap = new Map(safeUsers.map((u) => [String(u._id || u.id), u]));

  const contacts = [];
  for (const r of validRows) {
    const safe = safeMap.get(String(r.contactDetails._id));
    if (!safe) continue;
    contacts.push({
      ...safe,
      nickname: r.nickname ?? null,
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
  const safeUserIds = safeUsers.map((u) => u._id || u.id);

  const activeRequests = await ContactRequest.find({
    status: CONTACT_REQUEST_STATUS.PENDING,
    $or: [
      { senderId: currentUserId, recipientId: { $in: safeUserIds } },
      { senderId: { $in: safeUserIds }, recipientId: currentUserId },
    ],
  }).lean();

  const me = await userRepository.findByIdLeanSelect(currentUserId, "blockedUsers");
  const blockedSet = new Set((me?.blockedUsers || []).map(String));

  const resultUsers = await Promise.all(
    safeUsers.map(async (u) => {
      const uid = String(u._id || u.id);
      const isContact = myContactIds.has(uid);
      const isBlocked = blockedSet.has(uid);

      const sentReq = activeRequests.find(
        (r) => String(r.senderId) === String(currentUserId) && String(r.recipientId) === uid,
      );
      const incomingReq = activeRequests.find(
        (r) => String(r.recipientId) === String(currentUserId) && String(r.senderId) === uid,
      );

      let relationship = "none";
      let requestId = null;
      if (isBlocked) {
        relationship = "blocked";
      } else if (isContact) {
        relationship = "connected";
      } else if (sentReq) {
        relationship = "request_sent";
        requestId = String(sentReq._id);
      } else if (incomingReq) {
        relationship = "incoming_request";
        requestId = String(incomingReq._id);
      }

      const mutualCount = (await contactRepo.findMutualContactIds(currentUserId, uid)).length;

      return {
        ...u,
        isContact,
        isBlocked,
        relationship,
        requestId,
        mutualCount,
      };
    }),
  );

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

export const sendContactRequest = async (senderId, recipientId, note = "") => {
  assertValidObjectId(senderId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(recipientId, CONTACT_ERROR_MESSAGES.INVALID_USER_ID);

  if (String(senderId) === String(recipientId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.CANNOT_ADD_SELF,
    );
  }

  const recipient = await contactRepo.findUserById(recipientId);
  if (!recipient || recipient.status === USER_STATUS.SUSPENDED) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.USER_NOT_FOUND,
    );
  }

  const isBlocked = await contactRepo.isBlockedBidirectional(
    senderId,
    recipientId,
  );
  if (isBlocked) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      CONTACT_ERROR_MESSAGES.CANNOT_ADD_BLOCKED,
    );
  }

  const alreadyContact = await contactRepo.existsContact(senderId, recipientId);
  if (alreadyContact) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      CONTACT_ERROR_MESSAGES.ALREADY_CONTACTS,
    );
  }

  const existingPending = await contactRequestRepo.findActiveRequestBetween(
    senderId,
    recipientId,
  );
  if (existingPending) {
    if (String(existingPending.senderId) === String(senderId)) {
      throw new ApiError(
        StatusCodes.CONFLICT,
        CONTACT_ERROR_MESSAGES.REQUEST_ALREADY_SENT,
      );
    } else {
      return acceptContactRequest(senderId, existingPending._id);
    }
  }

  const sanitizedNote =
    typeof note === "string" ? note.trim().slice(0, 200) : "";
  const request = await contactRequestRepo.createRequest(
    senderId,
    recipientId,
    sanitizedNote,
  );

  const sender = await contactRepo.findUserById(
    senderId,
    "fullName username avatar profilePic bio phone",
  );
  contactEvents.emitContactRequestReceived(recipientId, {
    id: String(request._id),
    _id: String(request._id),
    requestId: String(request._id),
    sender: sender
      ? { ...sender, id: String(sender._id), _id: String(sender._id) }
      : { id: String(senderId), _id: String(senderId) },
    note: sanitizedNote,
    createdAt: request.createdAt,
  });

  contactEvents.emitContactRequestSent(senderId, {
    id: String(request._id),
    _id: String(request._id),
    requestId: String(request._id),
    recipientId: String(recipientId),
    note: sanitizedNote,
    createdAt: request.createdAt,
  });

  try {
    await notificationService.sendNotification({
      userId: recipientId,
      senderId,
      type: NOTIFICATION_TYPES.CONTACT_REQUEST_RECEIVED,
      title: "New Contact Request",
      body: `${sender?.fullName || "A user"} sent you a contact request.`,
      data: { requestId: String(request._id), senderId: String(senderId) },
    });
  } catch {}

  return {
    id: String(request._id),
    _id: String(request._id),
    requestId: String(request._id),
    recipientId: String(recipientId),
    status: CONTACT_REQUEST_STATUS.PENDING,
    message: CONTACT_SUCCESS_MESSAGES.REQUEST_SENT,
  };
};

export const getContactRequests = async (userId) => {
  assertValidObjectId(userId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);

  const [incoming, outgoing] = await Promise.all([
    contactRequestRepo.findIncomingRequests(userId),
    contactRequestRepo.findOutgoingRequests(userId),
  ]);

  const safeIncoming = [];
  for (const req of incoming) {
    if (!req.senderId) continue;
    const [safeSender] = await filterUsersForViewer([req.senderId], userId);
    if (!safeSender) continue;
    const mutualCount = (
      await contactRepo.findMutualContactIds(userId, req.senderId._id)
    ).length;
    safeIncoming.push({
      id: String(req._id),
      _id: String(req._id),
      requestId: String(req._id),
      sender: {
        ...safeSender,
        id: String(safeSender._id || safeSender.id),
        _id: String(safeSender._id || safeSender.id),
      },
      note: req.note || "",
      mutualCount,
      createdAt: req.createdAt,
    });
  }

  const safeOutgoing = [];
  for (const req of outgoing) {
    if (!req.recipientId) continue;
    const [safeRecipient] = await filterUsersForViewer(
      [req.recipientId],
      userId,
    );
    if (!safeRecipient) continue;
    safeOutgoing.push({
      id: String(req._id),
      _id: String(req._id),
      requestId: String(req._id),
      recipient: {
        ...safeRecipient,
        id: String(safeRecipient._id || safeRecipient.id),
        _id: String(safeRecipient._id || safeRecipient.id),
      },
      note: req.note || "",
      createdAt: req.createdAt,
    });
  }

  return { incoming: safeIncoming, outgoing: safeOutgoing };
};

export const acceptContactRequest = async (recipientId, requestId) => {
  assertValidObjectId(recipientId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(requestId, "Invalid request ID.");

  let request = await contactRequestRepo.findRequestById(requestId);
  if (!request) {
    request = await contactRequestRepo.findActiveRequestBetween(
      requestId,
      recipientId,
    );
  }

  if (!request) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.REQUEST_NOT_FOUND,
    );
  }

  if (String(request.recipientId) !== String(recipientId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not authorized to accept this contact request.",
    );
  }

  if (request.status !== CONTACT_REQUEST_STATUS.PENDING) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Contact request is already ${request.status}.`,
    );
  }

  const resolvedReqId = request._id;
  await contactRequestRepo.updateRequestStatus(
    resolvedReqId,
    CONTACT_REQUEST_STATUS.ACCEPTED,
  );

  const senderId = String(request.senderId);

  await Promise.all([
    contactRepo.upsertContact(recipientId, senderId),
    contactRepo.upsertContact(senderId, recipientId),
  ]);

  await contactEvents.syncPrivacy([recipientId, senderId]);

  contactEvents.emitContactAdded(recipientId, { contactId: senderId });
  contactEvents.emitContactAdded(senderId, { contactId: String(recipientId) });

  contactEvents.emitContactRequestAccepted(senderId, {
    requestId: String(resolvedReqId),
    acceptedBy: String(recipientId),
  });

  try {
    const recipient = await contactRepo.findUserById(recipientId, "fullName");
    await notificationService.sendNotification({
      userId: senderId,
      senderId: recipientId,
      type: NOTIFICATION_TYPES.CONTACT_REQUEST_ACCEPTED,
      title: "Contact Request Accepted",
      body: `${recipient?.fullName || "A user"} accepted your contact request.`,
      data: { requestId: String(resolvedReqId), contactId: String(recipientId) },
    });
  } catch {}

  return {
    id: String(resolvedReqId),
    _id: String(resolvedReqId),
    requestId: String(resolvedReqId),
    contactId: senderId,
    status: CONTACT_REQUEST_STATUS.ACCEPTED,
  };
};

export const rejectContactRequest = async (recipientId, requestId) => {
  assertValidObjectId(recipientId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(requestId, "Invalid request ID.");

  let request = await contactRequestRepo.findRequestById(requestId);
  if (!request) {
    request = await contactRequestRepo.findActiveRequestBetween(
      requestId,
      recipientId,
    );
  }

  if (!request) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.REQUEST_NOT_FOUND,
    );
  }

  if (String(request.recipientId) !== String(recipientId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not authorized to decline this contact request.",
    );
  }

  if (request.status !== CONTACT_REQUEST_STATUS.PENDING) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Contact request is already ${request.status}.`,
    );
  }

  const resolvedReqId = request._id;
  await contactRequestRepo.updateRequestStatus(
    resolvedReqId,
    CONTACT_REQUEST_STATUS.REJECTED,
  );

  contactEvents.emitContactRequestRejected(String(request.senderId), {
    requestId: String(resolvedReqId),
    rejectedBy: String(recipientId),
  });

  try {
    await notificationService.sendNotification({
      userId: request.senderId,
      senderId: recipientId,
      type: NOTIFICATION_TYPES.CONTACT_REQUEST_REJECTED,
      title: "Contact Request Declined",
      body: "Your contact request was declined.",
      data: { requestId: String(resolvedReqId) },
    });
  } catch {}

  return {
    id: String(resolvedReqId),
    _id: String(resolvedReqId),
    requestId: String(resolvedReqId),
    status: CONTACT_REQUEST_STATUS.REJECTED,
  };
};

export const cancelContactRequest = async (senderId, requestId) => {
  assertValidObjectId(senderId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  assertValidObjectId(requestId, "Invalid request ID.");

  let request = await contactRequestRepo.findRequestById(requestId);
  if (!request) {
    request = await contactRequestRepo.findActiveRequestBetween(
      senderId,
      requestId,
    );
  }

  if (!request) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      CONTACT_ERROR_MESSAGES.REQUEST_NOT_FOUND,
    );
  }

  if (String(request.senderId) !== String(senderId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "You are not authorized to cancel this contact request.",
    );
  }

  if (request.status !== CONTACT_REQUEST_STATUS.PENDING) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      `Contact request is already ${request.status}.`,
    );
  }

  const resolvedReqId = request._id;
  await contactRequestRepo.updateRequestStatus(
    resolvedReqId,
    CONTACT_REQUEST_STATUS.CANCELLED,
  );

  contactEvents.emitContactRequestCancelled(String(request.recipientId), {
    requestId: String(resolvedReqId),
    cancelledBy: String(senderId),
  });

  try {
    await notificationService.sendNotification({
      userId: request.recipientId,
      senderId,
      type: NOTIFICATION_TYPES.CONTACT_REQUEST_CANCELLED,
      title: "Contact Request Cancelled",
      body: "A contact request was cancelled.",
      data: { requestId: String(resolvedReqId) },
    });
  } catch {}

  return {
    id: String(resolvedReqId),
    _id: String(resolvedReqId),
    requestId: String(resolvedReqId),
    status: CONTACT_REQUEST_STATUS.CANCELLED,
  };
};

export const getRequestHistory = async (userId, query = {}) => {
  assertValidObjectId(userId, CONTACT_ERROR_MESSAGES.OWNER_REQUIRED);
  const { status, page = 1, limit = 20 } = query;
  const skip = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(50, Math.max(1, parseInt(limit, 10)));
  const { items, total } = await contactRequestRepo.findRequestHistory(userId, {
    status,
    skip,
    limit: Math.min(50, Math.max(1, parseInt(limit, 10))),
  });

  const formattedItems = [];
  for (const r of items) {
    let safeSender = r.senderId;
    let safeRecipient = r.recipientId;
    if (safeSender && typeof safeSender === "object") {
      const [fSender] = await filterUsersForViewer([safeSender], userId);
      safeSender = fSender || safeSender;
    }
    if (safeRecipient && typeof safeRecipient === "object") {
      const [fRecipient] = await filterUsersForViewer([safeRecipient], userId);
      safeRecipient = fRecipient || safeRecipient;
    }
    formattedItems.push({
      id: String(r._id),
      _id: r._id,
      senderId: r.senderId?._id ? String(r.senderId._id) : String(r.senderId),
      sender: safeSender,
      recipientId: r.recipientId?._id ? String(r.recipientId._id) : String(r.recipientId),
      recipient: safeRecipient,
      status: r.status,
      note: r.note || "",
      createdAt: r.createdAt,
      respondedAt: r.respondedAt,
    });
  }

  return {
    items: formattedItems,
    total,
    page: parseInt(page, 10) || 1,
    limit: parseInt(limit, 10) || 20,
    totalPages: Math.ceil(total / (parseInt(limit, 10) || 20)),
  };
};

const contactService = {
  addContact,
  removeContact,
  getContacts,
  getContactById,
  updateContactNickname,
  bulkAddContacts,
  getMutualContacts,
  searchUsers,
  getContactCount,
  getChatList,
  sendContactRequest,
  getContactRequests,
  acceptContactRequest,
  rejectContactRequest,
  cancelContactRequest,
  getRequestHistory,
};

export default contactService;
