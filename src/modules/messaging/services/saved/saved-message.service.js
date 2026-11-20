import { StatusCodes } from "http-status-codes";
import ApiError from "../../../../shared/errors/api-error.js";
import SavedMessage from "../../models/saved-message.model.js";
import Message from "../../models/message.model.js";
import GroupMessage from "../../../groups/models/group-message.model.js";
import { getGroupAndMember } from "../../../groups/helpers/group.member.helpers.js";
import { assertValidObjectId, toObjectId } from "../../../../shared/utils/object-id.util.js";

/**
 * Saves a message (direct or group) to user's personal Saved Messages.
 */
export const saveMessage = async ({
  userId,
  messageId,
  messageModel = "Message",
  category = "Important",
  folder = "General",
  tags = [],
  note = "",
}) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(messageId, "Invalid message ID.");

  const isGroup = messageModel === "GroupMessage";
  let origMessage;
  let chatType = "direct";
  let peerId = null;
  let groupId = null;
  let cachedPreview = {
    senderName: "User",
    isE2EE: false,
    hasAttachment: false,
  };

  if (isGroup) {
    origMessage = await GroupMessage.findOne({
      _id: toObjectId(messageId),
      isDeleted: { $ne: true },
    }).populate("senderId", "fullName username avatar profilePic");

    if (!origMessage) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Group message not found.");
    }

    await getGroupAndMember(origMessage.groupId, userId);
    chatType = "group";
    groupId = origMessage.groupId;

    cachedPreview = {
      textSnippet: origMessage.e2ee ? "🔒 Encrypted Message" : origMessage.text?.slice(0, 100) || "",
      senderName: origMessage.senderId?.fullName || "Group Member",
      createdAt: origMessage.createdAt,
      isE2EE: Boolean(origMessage.e2ee),
      hasAttachment: Boolean(
        origMessage.image?.url || origMessage.file?.url || origMessage.audio?.url || origMessage.video?.url,
      ),
    };
  } else {
    origMessage = await Message.findOne({
      _id: toObjectId(messageId),
      isDeleted: { $ne: true },
    })
      .populate("senderId", "fullName username avatar profilePic")
      .populate("receiverId", "fullName username avatar profilePic");

    if (!origMessage) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Message not found.");
    }

    const isParticipant =
      String(origMessage.senderId._id || origMessage.senderId) === String(userId) ||
      String(origMessage.receiverId._id || origMessage.receiverId) === String(userId);
    if (!isParticipant) {
      throw new ApiError(StatusCodes.FORBIDDEN, "Not authorized to save this message.");
    }

    chatType = "direct";
    peerId =
      String(origMessage.senderId._id || origMessage.senderId) === String(userId)
        ? origMessage.receiverId._id || origMessage.receiverId
        : origMessage.senderId._id || origMessage.senderId;

    cachedPreview = {
      textSnippet: origMessage.e2ee ? "🔒 Encrypted Message" : origMessage.text?.slice(0, 100) || "",
      senderName: origMessage.senderId?.fullName || "User",
      createdAt: origMessage.createdAt,
      isE2EE: Boolean(origMessage.e2ee),
      hasAttachment: Boolean(
        origMessage.image?.url || origMessage.file?.url || origMessage.audio?.url || origMessage.video?.url,
      ),
    };
  }

  // Check if already saved
  let saved = await SavedMessage.findOne({
    userId: toObjectId(userId),
    messageId: toObjectId(messageId),
  });

  if (saved) {
    saved.category = category || saved.category;
    saved.folder = folder || saved.folder;
    if (tags && Array.isArray(tags)) saved.tags = tags;
    if (typeof note === "string") saved.note = note;
    saved.cachedPreview = cachedPreview;
    await saved.save();
    return saved;
  }

  saved = await SavedMessage.create({
    userId: toObjectId(userId),
    messageId: toObjectId(messageId),
    messageModel: isGroup ? "GroupMessage" : "Message",
    chatType,
    peerId,
    groupId,
    category: category || "Important",
    folder: folder || "General",
    tags: Array.isArray(tags) ? tags : [],
    note: typeof note === "string" ? note : "",
    cachedPreview,
    savedAt: new Date(),
  });

  return saved;
};

/**
 * Creates a standalone personal note.
 */
export const createPersonalNote = async ({
  userId,
  note,
  category = "Personal",
  folder = "Notes",
  tags = [],
}) => {
  assertValidObjectId(userId, "Invalid user ID.");

  const n = String(note || "").trim();
  if (!n) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Note text is required.");
  }

  const saved = await SavedMessage.create({
    userId: toObjectId(userId),
    chatType: "note",
    category: category || "Personal",
    folder: folder || "Notes",
    tags: Array.isArray(tags) ? tags : [],
    note: n,
    cachedPreview: {
      textSnippet: n.slice(0, 100),
      senderName: "Me",
      createdAt: new Date(),
      isE2EE: false,
      hasAttachment: false,
    },
    savedAt: new Date(),
  });

  return saved;
};

/**
 * Unsaves a message.
 */
export const unsaveMessage = async ({ userId, savedMessageId, messageId = null }) => {
  assertValidObjectId(userId, "Invalid user ID.");

  const filter = { userId: toObjectId(userId) };
  if (savedMessageId) {
    filter._id = toObjectId(savedMessageId);
  } else if (messageId) {
    filter.messageId = toObjectId(messageId);
  } else {
    throw new ApiError(StatusCodes.BAD_REQUEST, "savedMessageId or messageId is required.");
  }

  const result = await SavedMessage.findOneAndDelete(filter);
  if (!result) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Saved message not found.");
  }

  return { success: true, savedMessageId: String(result._id), messageId: result.messageId ? String(result.messageId) : null };
};

/**
 * Updates a saved message's metadata.
 */
export const updateSavedMessage = async ({ userId, savedMessageId, updates = {} }) => {
  assertValidObjectId(userId, "Invalid user ID.");
  assertValidObjectId(savedMessageId, "Invalid saved message ID.");

  const saved = await SavedMessage.findOne({
    _id: toObjectId(savedMessageId),
    userId: toObjectId(userId),
  });

  if (!saved) {
    throw new ApiError(StatusCodes.NOT_FOUND, "Saved message not found.");
  }

  if (updates.category) saved.category = updates.category;
  if (updates.folder) saved.folder = updates.folder;
  if (Array.isArray(updates.tags)) saved.tags = updates.tags;
  if (typeof updates.note === "string") saved.note = updates.note;
  if (typeof updates.isPinned === "boolean") saved.isPinned = updates.isPinned;

  await saved.save();
  return saved;
};

/**
 * Gets saved messages with pagination and filtering.
 */
export const getSavedMessages = async ({
  userId,
  category,
  folder,
  tag,
  chatType,
  q,
  isPinned,
  page = 1,
  limit = 50,
}) => {
  assertValidObjectId(userId, "Invalid user ID.");

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (p - 1) * l;

  const filter = { userId: toObjectId(userId) };

  if (category && category !== "All") filter.category = category;
  if (folder && folder !== "All") filter.folder = folder;
  if (tag) filter.tags = tag;
  if (chatType) filter.chatType = chatType;
  if (typeof isPinned === "boolean") filter.isPinned = isPinned;

  if (q && typeof q === "string" && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { note: regex },
      { tags: regex },
      { "cachedPreview.textSnippet": regex },
      { "cachedPreview.senderName": regex },
    ];
  }

  const [items, total] = await Promise.all([
    SavedMessage.find(filter)
      .sort({ isPinned: -1, savedAt: -1 })
      .skip(skip)
      .limit(l)
      .populate("peerId", "fullName username avatar profilePic")
      .populate("groupId", "name groupPhoto isAnnouncementOnly")
      .lean(),
    SavedMessage.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page: p,
    limit: l,
    totalPages: Math.ceil(total / l),
  };
};

/**
 * Aggregates categories and folders for user.
 */
export const getCategoriesAndFolders = async (userId) => {
  assertValidObjectId(userId, "Invalid user ID.");

  const uId = toObjectId(userId);

  const [categories, folders, tags] = await Promise.all([
    SavedMessage.aggregate([
      { $match: { userId: uId } },
      { $group: { _id: "$category", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    SavedMessage.distinct("folder", { userId: uId }),
    SavedMessage.distinct("tags", { userId: uId }),
  ]);

  const defaultCategories = [
    "Important",
    "Work",
    "Personal",
    "Ideas",
    "Links",
    "Documents",
    "Reminders",
    "Custom",
  ];

  const catMap = new Map();
  for (const c of categories) {
    if (c._id) catMap.set(c._id, c.count);
  }

  const categoryList = defaultCategories.map((name) => ({
    name,
    count: catMap.get(name) || 0,
  }));

  // Add any custom categories not in defaults
  for (const [name, count] of catMap.entries()) {
    if (!defaultCategories.includes(name)) {
      categoryList.push({ name, count });
    }
  }

  return {
    categories: categoryList,
    folders: folders.filter(Boolean),
    tags: tags.filter(Boolean),
  };
};
