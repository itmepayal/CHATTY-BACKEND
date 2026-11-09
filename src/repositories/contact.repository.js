import Contact from "../models/contact.model.js";
import User from "../models/users.model.js";
import Message from "../models/message.model.js";
import { toObjectId } from "../utils/object-id.util.js";
import { escapeRegex } from "../utils/sanitize.util.js";
import { USER_STATUS } from "../constants/contact.constants.js";
import {
  CONTACT_POPULATE_FIELDS,
  SEARCH_USER_FIELDS,
} from "../constants/user-fields.constants.js";

/**
 * Finds a single user document by ID.
 * @param {string} userId
 * @param {string} [selectFields]
 * @returns {Promise<object|null>}
 */
export const findUserById = async (userId, selectFields = "_id status") =>
  User.findById(toObjectId(userId)).select(selectFields).lean();

/**
 * Finds user documents matching a list of IDs.
 * @param {string[]} userIds
 * @param {string} [selectFields]
 * @returns {Promise<object[]>}
 */
export const findUsersByIds = async (
  userIds,
  selectFields = CONTACT_POPULATE_FIELDS,
) =>
  User.find({
    _id: { $in: userIds.map(toObjectId) },
    status: { $ne: USER_STATUS.SUSPENDED },
  })
    .select(selectFields)
    .lean();

/**
 * Finds the list of blocked user IDs for a given user.
 * @param {string} userId
 * @returns {Promise<string[]>}
 */
export const findUserBlockedList = async (userId) => {
  const doc = await User.findById(toObjectId(userId))
    .select("blockedUsers")
    .lean();
  return (doc?.blockedUsers || []).map(String);
};

/**
 * Checks bidirectional blocking between user A and user B.
 * @param {string} userA
 * @param {string} userB
 * @returns {Promise<boolean>}
 */
export const isBlockedBidirectional = async (userA, userB) => {
  const found = await User.exists({
    $or: [
      { _id: toObjectId(userA), blockedUsers: toObjectId(userB) },
      { _id: toObjectId(userB), blockedUsers: toObjectId(userA) },
    ],
  });
  return Boolean(found);
};

/**
 * Finds existing contacts for an owner with an exact contact ID.
 * @param {string} ownerId
 * @param {string} contactId
 * @returns {Promise<object|null>}
 */
export const findContact = async (ownerId, contactId) =>
  Contact.findOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  }).lean();

/**
 * Finds a contact by owner and contact ID, populating user details.
 * @param {string} ownerId
 * @param {string} contactId
 * @returns {Promise<object|null>}
 */
export const findContactWithUser = async (ownerId, contactId) =>
  Contact.findOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  })
    .populate("contactId", CONTACT_POPULATE_FIELDS)
    .lean();

/**
 * Performs an aggregation pipeline for owner's contacts with exact DB filtering and pagination.
 * @param {string} ownerId
 * @param {object} options
 * @param {number} options.skip
 * @param {number} options.limitNum
 * @param {boolean} options.isPaginated
 * @param {string} options.search
 * @returns {Promise<{ contacts: object[], total: number }>}
 */
export const findContactsAggregation = async (
  ownerId,
  { skip, limitNum, isPaginated, search },
) => {
  const pipeline = [
    { $match: { ownerId: toObjectId(ownerId) } },
    {
      $lookup: {
        from: "users",
        localField: "contactId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    { $match: { "user.status": { $ne: USER_STATUS.SUSPENDED } } },
  ];

  if (search) {
    const rx = new RegExp(escapeRegex(search), "i");
    pipeline.push({
      $match: {
        $or: [
          { nickname: rx },
          { "user.fullName": rx },
          { "user.username": rx },
        ],
      },
    });
  }

  const facetStages = {
    metadata: [{ $count: "total" }],
    data: [
      { $sort: { createdAt: -1 } },
      ...(isPaginated ? [{ $skip: skip }, { $limit: limitNum }] : []),
    ],
  };

  pipeline.push({ $facet: facetStages });

  const [result] = await Contact.aggregate(pipeline);
  const total = result?.metadata[0]?.total || 0;
  const rows = result?.data || [];

  return { rows, total };
};

/**
 * Counts total contact documents owned by a user where the contact user is not suspended.
 * @param {string} ownerId
 * @returns {Promise<number>}
 */
export const countContacts = async (ownerId) => {
  const [res] = await Contact.aggregate([
    { $match: { ownerId: toObjectId(ownerId) } },
    {
      $lookup: {
        from: "users",
        localField: "contactId",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: "$user" },
    { $match: { "user.status": { $ne: USER_STATUS.SUSPENDED } } },
    { $count: "total" },
  ]);
  return res?.total || 0;
};

/**
 * Upserts a contact relationship using atomic operations.
 * Sets ownerId and contactId on insert only, and sets or unsets nickname appropriately.
 * @param {string} ownerId
 * @param {string} contactId
 * @param {string|undefined} cleanNickname
 * @returns {Promise<object>}
 */
export const upsertContact = async (ownerId, contactId, cleanNickname) => {
  const updateOp = {
    $setOnInsert: {
      ownerId: toObjectId(ownerId),
      contactId: toObjectId(contactId),
    },
  };

  if (cleanNickname !== undefined) {
    updateOp.$set = { nickname: cleanNickname };
  }

  return Contact.updateOne(
    { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
    updateOp,
    { upsert: true },
  );
};

/**
 * Deletes a single contact link.
 * @param {string} ownerId
 * @param {string} contactId
 * @returns {Promise<{ deletedCount: number }>}
 */
export const deleteContact = async (ownerId, contactId) =>
  Contact.deleteOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  });

/**
 * Updates or clears custom nickname for an existing contact.
 * @param {string} ownerId
 * @param {string} contactId
 * @param {string|undefined} cleanNickname
 * @returns {Promise<object|null>}
 */
export const updateNickname = async (ownerId, contactId, cleanNickname) => {
  const updateOp = cleanNickname
    ? { $set: { nickname: cleanNickname } }
    : { $unset: { nickname: 1 } };

  return Contact.findOneAndUpdate(
    { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
    updateOp,
    { new: true },
  ).lean();
};

/**
 * Fast existence check for a contact link.
 * @param {string} ownerId
 * @param {string} contactId
 * @returns {Promise<boolean>}
 */
export const existsContact = async (ownerId, contactId) => {
  const res = await Contact.exists({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  });
  return Boolean(res);
};

/**
 * Returns an array of contactId strings saved by an owner.
 * @param {string} ownerId
 * @returns {Promise<string[]>}
 */
export const findContactIds = async (ownerId) => {
  const docs = await Contact.find({ ownerId: toObjectId(ownerId) })
    .select("contactId")
    .lean();
  return docs.map((d) => String(d.contactId));
};

/**
 * Finds contact IDs common to both users.
 * @param {string} userA
 * @param {string} userB
 * @returns {Promise<string[]>}
 */
export const findMutualContactIds = async (userA, userB) => {
  const [contactsA, contactsB] = await Promise.all([
    Contact.find({ ownerId: toObjectId(userA) }).select("contactId").lean(),
    Contact.find({ ownerId: toObjectId(userB) }).select("contactId").lean(),
  ]);

  const setA = new Set(contactsA.map((c) => String(c.contactId)));
  return contactsB
    .map((c) => String(c.contactId))
    .filter((id) => setA.has(id));
};

/**
 * Finds existing contacts for an owner out of a list of candidate IDs.
 * @param {string} ownerId
 * @param {string[]} candidateIds
 * @returns {Promise<Set<string>>}
 */
export const findExistingContactIdSet = async (ownerId, candidateIds) => {
  const docs = await Contact.find({
    ownerId: toObjectId(ownerId),
    contactId: { $in: candidateIds.map(toObjectId) },
  })
    .select("contactId")
    .lean();
  return new Set(docs.map((d) => String(d.contactId)));
};

/**
 * Finds users who are not suspended and checks their blocked list.
 * @param {string[]} userIds
 * @returns {Promise<object[]>}
 */
export const findUsersWithBlocked = async (userIds) =>
  User.find({
    _id: { $in: userIds.map(toObjectId) },
    status: { $ne: USER_STATUS.SUSPENDED },
  })
    .select("_id blockedUsers")
    .lean();

/**
 * Performs bulk insertion of contacts using bulkWrite with $setOnInsert.
 * @param {string} ownerId
 * @param {string[]} contactIds
 * @returns {Promise<object>}
 */
export const bulkUpsertContacts = async (ownerId, contactIds) => {
  const operations = contactIds.map((cId) => ({
    updateOne: {
      filter: { ownerId: toObjectId(ownerId), contactId: toObjectId(cId) },
      update: {
        $setOnInsert: {
          ownerId: toObjectId(ownerId),
          contactId: toObjectId(cId),
        },
      },
      upsert: true,
    },
  }));

  return Contact.bulkWrite(operations, { ordered: false });
};

/**
 * Searches users discoverable by name, username, or exact email.
 * @param {object} params
 * @param {string} params.currentUserId
 * @param {string[]} params.blockedUserIds
 * @param {RegExp} params.nameOrUsernameRegex
 * @param {string} params.exactEmail
 * @param {number} params.limit
 * @returns {Promise<object[]>}
 */
export const searchDiscoverableUsers = async ({
  currentUserId,
  blockedUserIds,
  nameOrUsernameRegex,
  exactEmail,
  limit,
}) =>
  User.find({
    _id: { $ne: toObjectId(currentUserId), $nin: blockedUserIds.map(toObjectId) },
    blockedUsers: { $ne: toObjectId(currentUserId) },
    status: { $ne: USER_STATUS.SUSPENDED },
    $or: [
      { fullName: nameOrUsernameRegex },
      { username: nameOrUsernameRegex },
      { email: exactEmail },
    ],
  })
    .select(SEARCH_USER_FIELDS)
    .limit(limit)
    .lean();

/**
 * Aggregates latest messages and unread counts for contact chat list.
 * @param {string} ownerId
 * @param {string[]} activeContactIds
 * @returns {Promise<Map<string, object>>}
 */
export const aggregateChatListMessages = async (ownerId, activeContactIds) => {
  const me = toObjectId(ownerId);
  const targetObjectIds = activeContactIds.map(toObjectId);

  const results = await Message.aggregate([
    {
      $match: {
        deletedFor: { $ne: me },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        $or: [
          { senderId: me, receiverId: { $in: targetObjectIds } },
          { receiverId: me, senderId: { $in: targetObjectIds } },
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

  return new Map(results.map((r) => [String(r._id), r]));
};
