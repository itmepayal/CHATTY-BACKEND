import Contact from "../models/contact.model.js";
import User from "../../users/models/users.model.js";
import Message from "../../messaging/models/message.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";
import { escapeRegex } from "../../../shared/utils/sanitize.util.js";
import {
  USER_STATUS,
  SEARCH_RESULT_LIMIT,
} from "../constants/contact.constants.js";
import {
  CONTACT_POPULATE_FIELDS,
  SEARCH_USER_FIELDS,
} from "../../users/constants/user-fields.constants.js";

export const findUserById = async (
  userId,
  selectFields = "_id status",
  options = {},
) => {
  const query = User.findById(toObjectId(userId)).select(selectFields);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findUsersByIds = async (
  userIds,
  selectFields = CONTACT_POPULATE_FIELDS,
  options = {},
) => {
  const query = User.find({
    _id: { $in: userIds.map(toObjectId) },
    status: { $ne: USER_STATUS.SUSPENDED },
  }).select(selectFields);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findUsersWithBlocked = async (userIds, options = {}) => {
  const query = User.find({
    _id: { $in: userIds.map(toObjectId) },
    status: { $ne: USER_STATUS.SUSPENDED },
  }).select("_id blockedUsers fullName username");
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findUserBlockedList = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select("blockedUsers");
  if (options.session) query.session(options.session);
  const doc = await query.lean();
  return (doc?.blockedUsers || []).map(String);
};

export const isBlockedBidirectional = async (userA, userB, options = {}) => {
  const query = User.exists({
    $or: [
      { _id: toObjectId(userA), blockedUsers: toObjectId(userB) },
      { _id: toObjectId(userB), blockedUsers: toObjectId(userA) },
    ],
  });
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

export const findContact = async (ownerId, contactId, options = {}) => {
  const query = Contact.findOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  });
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const existsContact = async (ownerId, contactId, options = {}) => {
  const query = Contact.exists({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  });
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

export const findContactWithUser = async (ownerId, contactId, options = {}) => {
  const query = Contact.findOne({
    ownerId: toObjectId(ownerId),
    contactId: toObjectId(contactId),
  }).populate("contactId", CONTACT_POPULATE_FIELDS);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

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
                profilePhotoVisibility:
                  "$contactDetails.profilePhotoVisibility",
                aboutVisibility: "$contactDetails.aboutVisibility",
                onlineStatusVisibility:
                  "$contactDetails.onlineStatusVisibility",
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

export const countContacts = async (ownerId, options = {}) => {
  const query = Contact.countDocuments({ ownerId: toObjectId(ownerId) });
  if (options.session) query.session(options.session);
  return query;
};

export const upsertContact = async (
  ownerId,
  contactId,
  nickname,
  options = {},
) => {
  const query = Contact.findOneAndUpdate(
    { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
    { $set: { nickname, contactId: toObjectId(contactId) } },
    { upsert: true, new: true, setDefaultsOnInsert: true, ...options },
  );
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const deleteContact = async (ownerId, contactId, options = {}) =>
  Contact.deleteOne(
    {
      ownerId: toObjectId(ownerId),
      contactId: toObjectId(contactId),
    },
    options,
  );

export const updateNickname = async (
  ownerId,
  contactId,
  nickname,
  options = {},
) => {
  const query = Contact.findOneAndUpdate(
    { ownerId: toObjectId(ownerId), contactId: toObjectId(contactId) },
    { $set: { nickname } },
    { new: true, ...options },
  );
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findExistingContactIds = async (
  ownerId,
  contactIds,
  options = {},
) => {
  const query = Contact.find({
    ownerId: toObjectId(ownerId),
    contactId: { $in: contactIds.map(toObjectId) },
  }).select("contactId");
  if (options.session) query.session(options.session);
  const docs = await query.lean();
  return docs.map((d) => String(d.contactId));
};

export const findExistingContactIdSet = async (
  ownerId,
  candidateIds,
  options = {},
) => {
  const ids = await findExistingContactIds(ownerId, candidateIds, options);
  return new Set(ids);
};

export const findContactIds = async (ownerId, options = {}) => {
  const query = Contact.find({ ownerId: toObjectId(ownerId) }).select(
    "contactId",
  );
  if (options.session) query.session(options.session);
  const docs = await query.lean();
  return docs.map((d) => String(d.contactId));
};

export const bulkUpsertContacts = async (ownerId, contactIds, options = {}) => {
  const oId = toObjectId(ownerId);
  const ops = contactIds.map((cid) => ({
    updateOne: {
      filter: { ownerId: oId, contactId: toObjectId(cid) },
      update: { $setOnInsert: { ownerId: oId, contactId: toObjectId(cid) } },
      upsert: true,
    },
  }));
  return Contact.bulkWrite(ops, { ordered: false, ...options });
};

export const insertManyContacts = async (docs, options = { ordered: false }) =>
  Contact.insertMany(docs, options);

export const findMutualContactIds = async (userA, userB, options = {}) => {
  const queryA = Contact.find({ ownerId: toObjectId(userA) }).select(
    "contactId",
  );
  const queryB = Contact.find({ ownerId: toObjectId(userB) }).select(
    "contactId",
  );
  if (options.session) {
    queryA.session(options.session);
    queryB.session(options.session);
  }
  const [contactsA, contactsB] = await Promise.all([
    queryA.lean(),
    queryB.lean(),
  ]);

  const setB = new Set(contactsB.map((c) => String(c.contactId)));
  return contactsA.map((c) => String(c.contactId)).filter((id) => setB.has(id));
};

export const findMutualContacts = async (userA, userB, options = {}) => {
  const mutualIds = await findMutualContactIds(userA, userB, options);
  if (mutualIds.length === 0) return [];

  const query = User.find({
    _id: { $in: mutualIds.map(toObjectId) },
    status: { $ne: USER_STATUS.SUSPENDED },
  }).select(CONTACT_POPULATE_FIELDS);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const searchDiscoverableUsers = async (
  {
    currentUserId,
    blockedUserIds = [],
    nameOrUsernameRegex,
    exactEmail,
    limit = SEARCH_RESULT_LIMIT,
  },
  options = {},
) => {
  const blockedOids = blockedUserIds.map(toObjectId);
  const query = User.find({
    _id: { $ne: toObjectId(currentUserId), $nin: blockedOids },
    status: { $ne: USER_STATUS.SUSPENDED },
    $or: [
      { fullName: nameOrUsernameRegex },
      { username: nameOrUsernameRegex },
      { email: exactEmail },
    ],
  })
    .select(SEARCH_USER_FIELDS)
    .limit(limit);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const searchUsers = async (
  query,
  excludeUserId,
  limit = SEARCH_RESULT_LIMIT,
  options = {},
) => {
  const escaped = escapeRegex(query);
  const regex = new RegExp(escaped, "i");

  const q = User.find({
    _id: { $ne: toObjectId(excludeUserId) },
    status: { $ne: USER_STATUS.SUSPENDED },
    $or: [{ fullName: regex }, { username: regex }, { email: regex }],
  })
    .select(SEARCH_USER_FIELDS)
    .limit(limit);
  if (options.session) q.session(options.session);
  return options.lean === false ? q : q.lean();
};

export const aggregateChatListMessages = async (
  currentUserId,
  activeContactIds,
  options = {},
) => {
  const uid = toObjectId(currentUserId);
  const cids = activeContactIds.map(toObjectId);
  const pipeline = [
    {
      $match: {
        $or: [
          { senderId: uid, receiverId: { $in: cids } },
          { receiverId: uid, senderId: { $in: cids } },
        ],
        deletedFor: { $ne: uid },
        deletedForEveryone: { $ne: true },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: {
          $cond: [{ $eq: ["$senderId", uid] }, "$receiverId", "$senderId"],
        },
        lastMessage: { $first: "$$ROOT" },
      },
    },
  ];

  const results = await Message.aggregate(pipeline);
  const map = new Map();
  for (const row of results) {
    map.set(String(row._id), row.lastMessage);
  }
  return map;
};

export const find = (filter = {}, projection, options = {}) => {
  const query = Contact.find(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const exists = async (filter, options = {}) => {
  const query = Contact.exists(filter);
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

export const deleteInvolvingUser = (userId, options = {}) => {
  const uid = toObjectId(userId);
  return Contact.deleteMany(
    { $or: [{ ownerId: uid }, { contactId: uid }] },
    options,
  );
};

export const deleteManyForUser = (userId, options) =>
  deleteInvolvingUser(userId, options);

export const distinctContactIds = (filter, options = {}) => {
  const query = Contact.distinct("contactId", filter);
  if (options.session) query.session(options.session);
  return query;
};

const contactRepository = Object.freeze({
  findUserById,
  findUsersByIds,
  findUsersWithBlocked,
  findUserBlockedList,
  isBlockedBidirectional,
  findContact,
  existsContact,
  findContactWithUser,
  findContactsAggregation,
  countContacts,
  upsertContact,
  deleteContact,
  updateNickname,
  findExistingContactIds,
  findExistingContactIdSet,
  findContactIds,
  bulkUpsertContacts,
  insertManyContacts,
  findMutualContactIds,
  findMutualContacts,
  searchDiscoverableUsers,
  searchUsers,
  aggregateChatListMessages,
  find,
  exists,
  deleteInvolvingUser,
  deleteManyForUser,
  distinctContactIds,
});

export default contactRepository;
