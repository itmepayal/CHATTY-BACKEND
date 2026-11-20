import ContactRequest, {
  CONTACT_REQUEST_STATUS,
} from "../models/contact-request.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";
import { CONTACT_POPULATE_FIELDS } from "../../users/constants/user-fields.constants.js";

export const findPendingRequest = async (senderId, recipientId) => {
  return ContactRequest.findOne({
    senderId: toObjectId(senderId),
    recipientId: toObjectId(recipientId),
    status: CONTACT_REQUEST_STATUS.PENDING,
  }).lean();
};

export const findActiveRequestBetween = async (userA, userB) => {
  const oA = toObjectId(userA);
  const oB = toObjectId(userB);
  return ContactRequest.findOne({
    $or: [
      { senderId: oA, recipientId: oB, status: CONTACT_REQUEST_STATUS.PENDING },
      { senderId: oB, recipientId: oA, status: CONTACT_REQUEST_STATUS.PENDING },
    ],
  }).lean();
};

export const createRequest = async (senderId, recipientId, note = "") => {
  return ContactRequest.create({
    senderId: toObjectId(senderId),
    recipientId: toObjectId(recipientId),
    note,
    status: CONTACT_REQUEST_STATUS.PENDING,
  });
};

export const findRequestById = async (requestId) => {
  return ContactRequest.findById(toObjectId(requestId));
};

export const findIncomingRequests = async (recipientId) => {
  return ContactRequest.find({
    recipientId: toObjectId(recipientId),
    status: CONTACT_REQUEST_STATUS.PENDING,
  })
    .sort({ createdAt: -1 })
    .populate("senderId", CONTACT_POPULATE_FIELDS)
    .lean();
};

export const findOutgoingRequests = async (senderId) => {
  return ContactRequest.find({
    senderId: toObjectId(senderId),
    status: CONTACT_REQUEST_STATUS.PENDING,
  })
    .sort({ createdAt: -1 })
    .populate("recipientId", CONTACT_POPULATE_FIELDS)
    .lean();
};

export const updateRequestStatus = async (requestId, status) => {
  return ContactRequest.findByIdAndUpdate(
    toObjectId(requestId),
    {
      $set: {
        status,
        respondedAt: new Date(),
      },
    },
    { new: true },
  ).lean();
};

export const findRequestHistory = async (userId, { status, skip = 0, limit = 20 } = {}) => {
  const uId = toObjectId(userId);
  const filter = {
    $or: [{ senderId: uId }, { recipientId: uId }],
  };

  if (status && Object.values(CONTACT_REQUEST_STATUS).includes(status)) {
    filter.status = status;
  } else {
    filter.status = { $ne: CONTACT_REQUEST_STATUS.PENDING };
  }

  const [items, total] = await Promise.all([
    ContactRequest.find(filter)
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(Number(skip) || 0)
      .limit(Math.min(100, Math.max(1, Number(limit) || 20)))
      .populate("senderId", CONTACT_POPULATE_FIELDS)
      .populate("recipientId", CONTACT_POPULATE_FIELDS)
      .lean(),
    ContactRequest.countDocuments(filter),
  ]);

  return { items, total };
};

export const invalidateRequestsBetween = async (userA, userB) => {
  const oA = toObjectId(userA);
  const oB = toObjectId(userB);
  return ContactRequest.updateMany(
    {
      $or: [
        { senderId: oA, recipientId: oB, status: CONTACT_REQUEST_STATUS.PENDING },
        { senderId: oB, recipientId: oA, status: CONTACT_REQUEST_STATUS.PENDING },
      ],
    },
    {
      $set: {
        status: CONTACT_REQUEST_STATUS.CANCELLED,
        respondedAt: new Date(),
      },
    },
  );
};

const contactRequestRepository = Object.freeze({
  findPendingRequest,
  findActiveRequestBetween,
  createRequest,
  findRequestById,
  findIncomingRequests,
  findOutgoingRequests,
  updateRequestStatus,
  findRequestHistory,
  invalidateRequestsBetween,
});

export default contactRequestRepository;
