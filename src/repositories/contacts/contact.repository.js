import Contact from "../../models/contact.model.js";
import User from "../../models/users.model.js";
import Message from "../../models/message.model.js";
import { toObjectId } from "../../utils/object-id.util.js";
import { escapeRegex } from "../../utils/sanitize.util.js";
import { USER_STATUS } from "../../constants/contact.constants.js";
import {
  CONTACT_POPULATE_FIELDS,
  SEARCH_USER_FIELDS,
} from "../../constants/user-fields.constants.js";

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
  { skip = 0, limitNum = 20, isPaginated = false, search = "" } = {},
) => {
  const oId = toObjectId(ownerId);
  const matchStage = { ownerId: oId };

  const pipeline = [
    { $match: matchStage },
    {
      $lookup: {
        from: "users",
        localField: "contactId",
        foreignField: "_id",
        as: "contactDetails",
      },
    },
    { $unwind: "$contactDetails" },
    {
      $match: {
        "contactDetails.status": { $ne: USER_STATUS.SUSPENDED },
      },
    },
  ];

  if (search) {
    const escaped = escapeRegex(search);
    const searchRegex = new RegExp(escaped, "i");
    pipeline.push({
      $match: {
        $or: [
          { nickname: searchRegex },
          { "contactDetails.fullName": searchRegex },
          { "contactDetails.username": searchRegex },
          { "contactDetails.phone": searchRegex },
        ],
      },
    });
  }

  const facetStages = [
    {
      $facet: {
        metadata: [{ $count: "total" }],
        data: [
          { $sort: { "contactDetails.fullName": 1 } },
          ...(isPaginated ? [{ $skip: skip }, { $limit: limitNum }] : []),
          {
            $project: {
              _id: 1,
              ownerId: 1,
              contactId: 1,
              nickname: 1,
              createdAt: 1,
              contactDetails: {
                _id: "$contactDetails._id",
                fullName: "$contactDetails.fullName",
                username: "$contactDetails.username",
                avatar: "$contactDetails.avatar",
                profilePic: "$contactDetails.profilePic",
                bio: "$contactDetails.bio",
                phone: "$contactDetails.phone",
                isOnline: "$contactDetails.isOnline",
                lastSeen: "$contactDetails.lastSeen",
                profilePhotoVisibility: "$contactDetails.profilePhotoVisibility",
                aboutVisibility: "$contactDetails.aboutVisibility",
                onlineStatusVisibility: "$contactDetails.onlineStatusVisibility",
                lastSeenVisibility: "$contactDetails.lastSeenVisibility",
                status: "$contactDetails.status",
              },
            },
          },
        ],
      },
    },
  ];

  const [result] = await Contact.aggregate([...pipeline, ...facetStages]);
  const total = result?.metadata[0]?.total || 0;
  const rows = result?.data || [];
  return { rows, total };
};

/**
 * Counts total contacts saved by an owner.
 * @param {string} ownerId
 * @returns {Promise<number>}
 */
export const countContacts = async (ownerId) =>
  Contact.countDocuments({ ownerId: toObjectId(ownerId) });

/**
 * Upserts a contact entry for ownerId and contactId with a given nickname.
 * @param {string} ownerId
 * @param {string} contactId
 * @param {string} nickname
 * @returns {Promise<object>}
 */
export const upsertContact = async (ownerId, contactId, nickname) =>
  Contact.findOneAndUpdate(
    { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
    { $set: { nickname, contactId: toObjectId(contactId) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

/**
 * Deletes a single contact entry between owner and contact.
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
 * Updates the nickname of an existing contact.
 * @param {string} ownerId
 * @param {string} contactId
 * @param {string} nickname
 * @returns {Promise<object|null>}
 */
export const updateNickname = async (ownerId, contactId, nickname) =>
  Contact.findOneAndUpdate(
    { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
    { $set: { nickname } },
    { new: true },
  ).lean();

/**
 * Finds contact IDs saved by owner that are also present in a target list.
 * @param {string} ownerId
 * @param {string[]} contactIds
 * @returns {Promise<string[]>}
 */
export const findExistingContactIds = async (ownerId, contactIds) => {
  const docs = await Contact.find({
    ownerId: toObjectId(ownerId),
    contactId: { $in: contactIds.map(toObjectId) },
  })
    .select("contactId")
    .lean();
  return docs.map((d) => String(d.contactId));
};

/**
 * Performs bulk insertion of contacts for an owner.
 * @param {object[]} docs
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
export const insertManyContacts = async (docs, options = { ordered: false }) =>
  Contact.insertMany(docs, options);

/**
 * Finds mutual contacts saved by both userA and userB.
 * @param {string} userA
 * @param {string} userB
 * @returns {Promise<object[]>}
 */
export const findMutualContacts = async (userA, userB) => {
  const [contactsA, contactsB] = await Promise.all([
    Contact.find({ ownerId: toObjectId(userA) }).select("contactId").lean(),
    Contact.find({ ownerId: toObjectId(userB) }).select("contactId").lean(),
  ]);

  const setB = new Set(contactsB.map((c) => String(c.contactId)));
  const mutualIds = contactsA
    .map((c) => String(c.contactId))
    .filter((id) => setB.has(id));

  if (mutualIds.length === 0) return [];

  return User.find({
    _id: { $in: mutualIds.map(toObjectId) },
    status: { $ne: USER_STATUS.SUSPENDED },
  })
    .select(CONTACT_POPULATE_FIELDS)
    .lean();
};

/**
 * Searches users matching a query string across fullName, username, and email.
 * @param {string} query
 * @param {string} excludeUserId
 * @param {number} [limit=20]
 * @returns {Promise<object[]>}
 */
export const searchUsers = async (
  query,
  excludeUserId,
  limit = SEARCH_RESULT_LIMIT,
) => {
  const escaped = escapeRegex(query);
  const regex = new RegExp(escaped, "i");

  return User.find({
    _id: { $ne: toObjectId(excludeUserId) },
    status: { $ne: USER_STATUS.SUSPENDED },
    $or: [{ fullName: regex }, { username: regex }, { email: regex }],
  })
    .select(SEARCH_USER_FIELDS)
    .limit(limit)
    .lean();
};

/**
 * Queries contacts with custom filter.
 * @param {object} filter
 * @returns {import("mongoose").Query}
 */
export const find = (filter) => Contact.find(filter);

/**
 * Checks existence with custom filter.
 * @param {object} filter
 * @returns {Promise<boolean>}
 */
export const exists = async (filter) => {
  const found = await Contact.exists(filter);
  return Boolean(found);
};

export const deleteManyForUser = (userId, options) =>
  Contact.deleteMany(
    { $or: [{ ownerId: userId }, { contactId: userId }] },
    options,
  );

export const distinctContactIds = (filter) => Contact.distinct("contactId", filter);

const contactRepository = {
  findUserById,
  findUsersByIds,
  findUserBlockedList,
  isBlockedBidirectional,
  findContact,
  findContactWithUser,
  findContactsAggregation,
  countContacts,
  upsertContact,
  deleteContact,
  updateNickname,
  findExistingContactIds,
  insertManyContacts,
  findMutualContacts,
  searchUsers,
  find,
  exists,
  deleteManyForUser,
  distinctContactIds,
};

export default contactRepository;
