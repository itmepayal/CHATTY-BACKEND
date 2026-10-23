import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/apiError.js";
import ApiResponse from "../utils/apiResponse.js";
import Group from "../models/group.model.js";
import GroupMessage from "../models/groupmessage.model.js";
import {
  uploadFileToCloudinary,
  deleteFileToCloudinary,
} from "../config/cloudinary.config.js";
import { io, groupRoom, getPrivacy } from "../lib/socket.js";
import {
  getGroupAndMember,
  assertAdmin,
  getBlockedByMe,
  getBlockersOf,
  assertUsersAddable,
} from "../utils/groupguard.js";

const MAX_MEMBERS = 256;
const MAX_TEXT = 2000;
const MAX_VOICE_SECONDS = 300;

const sid = (x) => String(x?._id ?? x);

const parseIds = (raw) => {
  if (!raw) return [];
  let arr = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = raw.split(",");
    }
  }
  if (!Array.isArray(arr)) arr = [arr];
  const ids = [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
  if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID in list.");
  }
  return ids;
};

const validName = (name) => {
  if (!name || name.length < 2 || name.length > 50) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Group name must be 2-50 characters.",
    );
  }
};

const uploadImage = async (file) => {
  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload image.");
  }
  return { public_id: up.public_id, url: up.secure_url };
};

const uploadAttachment = async (file, { isVoice = false, duration } = {}) => {
  const up = await uploadFileToCloudinary(file.path);
  if (!up?.public_id || !up?.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload attachment.");
  }

  if (file.mimetype?.startsWith("image/")) {
    return { image: { public_id: up.public_id, url: up.secure_url } };
  }

  if (isVoice && file.mimetype?.startsWith("audio/")) {
    const seconds = Math.round(Number(duration) || up.duration || 0);
    return {
      audio: {
        public_id: up.public_id,
        url: up.secure_url,
        duration: Math.min(Math.max(seconds, 0), MAX_VOICE_SECONDS),
        mimeType: file.mimetype.split(";")[0],
        resourceType: up.resource_type,
      },
    };
  }

  return {
    file: {
      public_id: up.public_id,
      url: up.secure_url,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
      resourceType: up.resource_type,
    },
  };
};

const deleteMedia = (m) => [
  m.image?.public_id && deleteFileToCloudinary(m.image.public_id, "image"),
  m.file?.public_id &&
    deleteFileToCloudinary(m.file.public_id, m.file.resourceType || "raw"),
  m.audio?.public_id &&
    deleteFileToCloudinary(m.audio.public_id, m.audio.resourceType || "video"),
];

const loadGroup = (id) =>
  Group.findById(id).populate("members.userId", "fullName avatar");

const formatGroup = (group, extra = {}) => ({
  id: group._id,
  name: group.name,
  avatar: group.avatar?.url || "",
  owner: sid(group.owner),
  members: group.members.map((m) => ({
    id: sid(m.userId),
    fullName: m.userId?.fullName || "",
    avatar: m.userId?.avatar?.url || "",
    role: m.role,
    joinedAt: m.joinedAt,
  })),
  createdAt: group.createdAt,
  lastMessageAt: group.lastMessageAt || group.createdAt,
  unreadCount: 0,
  lastMessage: null,
  ...extra,
});

const formatGroupMessage = (msg) => {
  const sender = msg.senderId?._id ? msg.senderId : null;
  return {
    id: msg._id,
    groupId: sid(msg.groupId),
    senderId: sid(msg.senderId),
    sender: sender
      ? {
          id: sid(sender),
          fullName: sender.fullName,
          avatar: sender.avatar?.url || "",
        }
      : null,
    text: msg.text || "",
    image: msg.image?.url
      ? { url: msg.image.url, public_id: msg.image.public_id }
      : null,
    file: msg.file?.url
      ? {
          url: msg.file.url,
          name: msg.file.name,
          size: msg.file.size,
          mimeType: msg.file.mimeType,
        }
      : null,
    audio: msg.audio?.url
      ? {
          url: msg.audio.url,
          duration: msg.audio.duration || 0,
          mimeType: msg.audio.mimeType,
        }
      : null,
    clientId: msg.clientId,
    readBy: (msg.readBy || []).map(String),
    createdAt: msg.createdAt,
  };
};

const emitToMembers = (group, event, payload, exceptIds = []) => {
  const skip = new Set(exceptIds.map(String));
  for (const m of group.members) {
    const uid = sid(m.userId);
    if (!skip.has(uid)) io.to(uid).emit(event, payload);
  }
};

const joinRoom = (userId, groupId) =>
  io.in(String(userId)).socketsJoin(groupRoom(groupId));
const leaveRoom = (userId, groupId) =>
  io.in(String(userId)).socketsLeave(groupRoom(groupId));

const getUnread = (groupId, userId, joinedAt, blockedIds) =>
  GroupMessage.countDocuments({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: [...blockedIds, userId] },
    readBy: { $ne: userId },
    silentReadBy: { $ne: userId },
  });

const getLast = (groupId, joinedAt, blockedIds) =>
  GroupMessage.findOne({
    groupId,
    createdAt: { $gte: joinedAt },
    senderId: { $nin: blockedIds },
  })
    .sort({ createdAt: -1 })
    .populate("senderId", "fullName avatar");

const emitMemberConversation = async (groupId, member) => {
  const uid = sid(member.userId);
  const blocked = await getBlockedByMe(uid);
  const [unreadCount, last] = await Promise.all([
    getUnread(groupId, uid, member.joinedAt, blocked),
    getLast(groupId, member.joinedAt, blocked),
  ]);
  io.to(uid).emit("group:conversationUpdated", {
    groupId: String(groupId),
    unreadCount,
    lastMessage: last ? formatGroupMessage(last) : null,
    lastMessageAt: last?.createdAt ?? null,
    ts: Date.now(),
  });
};

const emitGroupConversation = async (group) => {
  try {
    await Promise.all(
      group.members.map((m) => emitMemberConversation(group._id, m)),
    );
  } catch (err) {
    console.error("emitGroupConversation failed:", err?.message || err);
  }
};

const destroyGroup = async (group) => {
  const media = await GroupMessage.find({
    groupId: group._id,
    $or: [
      { "image.public_id": { $exists: true, $ne: null } },
      { "file.public_id": { $exists: true, $ne: null } },
      { "audio.public_id": { $exists: true, $ne: null } },
    ],
  })
    .select("image file audio")
    .lean();

  await Promise.allSettled([
    ...media.flatMap(deleteMedia),
    group.avatar?.public_id && deleteFileToCloudinary(group.avatar.public_id),
  ]);
  await GroupMessage.deleteMany({ groupId: group._id });
  await Group.deleteOne({ _id: group._id });
};

const groupController = {
  createGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const name = req.body.name?.trim();
    validName(name);

    const memberIds = parseIds(req.body.memberIds).filter(
      (id) => id !== String(me),
    );
    if (!memberIds.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Add at least one member.");
    }
    if (memberIds.length + 1 > MAX_MEMBERS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `A group can have at most ${MAX_MEMBERS} members.`,
      );
    }
    await assertUsersAddable(me, memberIds);

    const avatar = req.file?.path ? await uploadImage(req.file) : undefined;

    const created = await Group.create({
      name,
      avatar,
      owner: me,
      members: [
        { userId: me, role: "admin" },
        ...memberIds.map((userId) => ({ userId, role: "member" })),
      ],
      lastMessageAt: new Date(),
    });

    [String(me), ...memberIds].forEach((id) => joinRoom(id, created._id));

    const group = await loadGroup(created._id);
    const payload = formatGroup(group);
    emitToMembers(group, "group:created", payload);

    return new ApiResponse(StatusCodes.CREATED, payload, "Group created.").send(
      res,
    );
  }),

  getMyGroups: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const [groups, blocked] = await Promise.all([
      Group.find({ "members.userId": me }).populate(
        "members.userId",
        "fullName avatar",
      ),
      getBlockedByMe(me),
    ]);

    const result = await Promise.all(
      groups.map(async (g) => {
        const mine = g.members.find((m) => sid(m.userId) === String(me));
        const [unreadCount, last] = await Promise.all([
          getUnread(g._id, me, mine.joinedAt, blocked),
          getLast(g._id, mine.joinedAt, blocked),
        ]);
        return formatGroup(g, {
          unreadCount,
          lastMessage: last ? formatGroupMessage(last) : null,
          lastMessageAt: last?.createdAt || g.lastMessageAt || g.createdAt,
        });
      }),
    );

    result.sort(
      (a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt),
    );

    return new ApiResponse(StatusCodes.OK, result, "Groups fetched.").send(res);
  }),

  getGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    await getGroupAndMember(req.params.id, me);
    const group = await loadGroup(req.params.id);
    return new ApiResponse(
      StatusCodes.OK,
      formatGroup(group),
      "Group fetched.",
    ).send(res);
  }),

  updateGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    let changed = false;
    let oldPublicId;

    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      validName(name);
      if (name !== group.name) {
        group.name = name;
        changed = true;
      }
    }

    if (req.file?.path) {
      oldPublicId = group.avatar?.public_id;
      group.avatar = await uploadImage(req.file);
      changed = true;
    }

    if (!changed) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No changes to update.");
    }

    await group.save();
    if (oldPublicId) await deleteFileToCloudinary(oldPublicId).catch(() => {});

    const full = await loadGroup(group._id);
    const payload = formatGroup(full);
    emitToMembers(full, "group:updated", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Group updated.").send(res);
  }),

  addMembers: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    const existing = new Set(group.members.map((m) => sid(m.userId)));
    const newIds = parseIds(req.body.memberIds).filter(
      (id) => !existing.has(id),
    );

    if (!newIds.length) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "No new members to add.");
    }
    if (group.members.length + newIds.length > MAX_MEMBERS) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `A group can have at most ${MAX_MEMBERS} members.`,
      );
    }
    await assertUsersAddable(me, newIds);

    const joinedAt = new Date();
    group.members.push(
      ...newIds.map((userId) => ({ userId, role: "member", joinedAt })),
    );
    await group.save();

    newIds.forEach((id) => joinRoom(id, group._id));

    const full = await loadGroup(group._id);
    const payload = formatGroup(full);
    emitToMembers(full, "group:created", payload, [...existing]);
    emitToMembers(full, "group:updated", payload, newIds);

    return new ApiResponse(StatusCodes.OK, payload, "Members added.").send(res);
  }),

  removeMember: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
    }
    if (targetId === String(me)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Use 'leave group' to remove yourself.",
      );
    }

    const target = group.members.find((m) => sid(m.userId) === targetId);
    if (!target)
      throw new ApiError(StatusCodes.NOT_FOUND, "User is not in this group.");

    if (targetId === sid(group.owner)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "The group owner can't be removed.",
      );
    }
    if (target.role === "admin" && sid(group.owner) !== String(me)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Only the owner can remove an admin.",
      );
    }

    group.members = group.members.filter((m) => sid(m.userId) !== targetId);
    await group.save();

    leaveRoom(targetId, group._id);
    io.to(targetId).emit("group:removed", {
      groupId: String(group._id),
      reason: "removed",
    });

    const full = await loadGroup(group._id);
    const payload = formatGroup(full);
    emitToMembers(full, "group:updated", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Member removed.").send(
      res,
    );
  }),

  changeRole: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { role } = req.body;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
    }
    if (!["admin", "member"].includes(role)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Role must be 'admin' or 'member'.",
      );
    }
    const target = group.members.find((m) => sid(m.userId) === targetId);
    if (!target)
      throw new ApiError(StatusCodes.NOT_FOUND, "User is not in this group.");

    if (targetId === sid(group.owner)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "The owner's role can't be changed.",
      );
    }
    if (targetId === String(me)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "You can't change your own role.",
      );
    }
    if (
      role === "member" &&
      target.role === "admin" &&
      sid(group.owner) !== String(me)
    ) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Only the owner can demote an admin.",
      );
    }

    target.role = role;
    await group.save();

    const full = await loadGroup(group._id);
    const payload = formatGroup(full);
    emitToMembers(full, "group:updated", payload);

    return new ApiResponse(StatusCodes.OK, payload, "Role updated.").send(res);
  }),

  leaveGroup: asyncHandler(async (req, res) => {
    const me = String(req.user._id);
    const { group } = await getGroupAndMember(req.params.id, me);

    group.members = group.members.filter((m) => sid(m.userId) !== me);

    if (group.members.length === 0) {
      await destroyGroup(group);
      leaveRoom(me, group._id);
      io.to(me).emit("group:removed", {
        groupId: String(group._id),
        reason: "left",
      });
      return new ApiResponse(
        StatusCodes.OK,
        null,
        "You left. The group was deleted.",
      ).send(res);
    }

    const byJoin = [...group.members].sort((a, b) => a.joinedAt - b.joinedAt);
    if (!group.members.some((m) => m.role === "admin"))
      byJoin[0].role = "admin";
    if (sid(group.owner) === me) {
      group.owner = byJoin.find((m) => m.role === "admin").userId;
    }
    await group.save();

    leaveRoom(me, group._id);
    io.to(me).emit("group:removed", {
      groupId: String(group._id),
      reason: "left",
    });

    const full = await loadGroup(group._id);
    emitToMembers(full, "group:updated", formatGroup(full));

    return new ApiResponse(StatusCodes.OK, null, "You left the group.").send(
      res,
    );
  }),

  deleteGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    if (sid(group.owner) !== String(me)) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Only the group owner can delete the group.",
      );
    }

    const payload = { groupId: String(group._id) };
    emitToMembers(group, "group:deleted", payload);
    io.in(groupRoom(group._id)).socketsLeave(groupRoom(group._id));

    await destroyGroup(group);

    return new ApiResponse(StatusCodes.OK, payload, "Group deleted.").send(res);
  }),

  getGroupMessages: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const blocked = await getBlockedByMe(me);

    const limit = Math.min(Number(req.query.limit) || 100, 200);
    const createdAt = { $gte: member.joinedAt };
    if (req.query.before) {
      const d = new Date(req.query.before);
      if (!Number.isNaN(d.getTime())) createdAt.$lt = d;
    }

    const msgs = await GroupMessage.find({
      groupId: group._id,
      createdAt,
      senderId: { $nin: blocked },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("senderId", "fullName avatar");

    return new ApiResponse(
      StatusCodes.OK,
      msgs.reverse().map(formatGroupMessage),
      "Group messages fetched.",
    ).send(res);
  }),

  sendGroupMessage: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const text = req.body.text?.trim();
    const clientId =
      typeof req.body.clientId === "string" && req.body.clientId.length <= 64
        ? req.body.clientId
        : undefined;
    const isVoice = req.body.isVoice === "true" || req.body.isVoice === true;

    if (!text && !req.file) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Message cannot be empty.");
    }
    if (text && text.length > MAX_TEXT) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Message can be at most ${MAX_TEXT} characters.`,
      );
    }
    if (isVoice && req.file && !req.file.mimetype?.startsWith("audio/")) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Voice message must be an audio file.",
      );
    }

    const findDuplicate = () =>
      GroupMessage.findOne({
        groupId: group._id,
        senderId: me,
        clientId,
      }).populate("senderId", "fullName avatar");

    if (clientId) {
      const dup = await findDuplicate();
      if (dup) {
        return new ApiResponse(
          StatusCodes.OK,
          formatGroupMessage(dup),
          "Message already sent.",
        ).send(res);
      }
    }

    const attachment = req.file?.path
      ? await uploadAttachment(req.file, {
          isVoice,
          duration: req.body.duration,
        })
      : {};

    let message;
    try {
      message = await GroupMessage.create({
        groupId: group._id,
        senderId: me,
        text,
        ...attachment,
        clientId,
        readBy: [me],
      });
    } catch (error) {
      // Our upload is now orphaned (create failed or lost a duplicate race).
      await Promise.allSettled(deleteMedia(attachment));

      if (error?.code === 11000 && clientId) {
        const dup = await findDuplicate();
        if (dup) {
          return new ApiResponse(
            StatusCodes.OK,
            formatGroupMessage(dup),
            "Message already sent.",
          ).send(res);
        }
      }
      throw error;
    }

    await message.populate("senderId", "fullName avatar");
    await Group.updateOne(
      { _id: group._id },
      { lastMessageAt: message.createdAt },
    );

    const payload = formatGroupMessage(message);

    const memberIds = group.members.map((m) => sid(m.userId));
    const blockers = await getBlockersOf(memberIds, me);
    memberIds
      .filter((id) => !blockers.has(id))
      .forEach((id) => io.to(id).emit("group:newMessage", payload));

    emitGroupConversation(group);

    return new ApiResponse(StatusCodes.CREATED, payload, "Message sent.").send(
      res,
    );
  }),

  markGroupSeen: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const blocked = await getBlockedByMe(me);
    const { readReceipts } = getPrivacy(me);

    const unread = await GroupMessage.find({
      groupId: group._id,
      createdAt: { $gte: member.joinedAt },
      senderId: { $nin: [...blocked, me] },
      readBy: { $ne: me },
      silentReadBy: { $ne: me },
    }).select("_id");

    const ids = unread.map((m) => m._id);

    if (ids.length) {
      if (readReceipts) {
        await GroupMessage.updateMany(
          { _id: { $in: ids } },
          { $addToSet: { readBy: me } },
        );
        io.to(groupRoom(group._id)).emit("group:messagesSeen", {
          groupId: String(group._id),
          seenBy: String(me),
          messageIds: ids,
        });
      } else {
        await GroupMessage.updateMany(
          { _id: { $in: ids } },
          { $addToSet: { silentReadBy: me } },
        );
      }
    }

    await emitMemberConversation(group._id, member);

    return new ApiResponse(
      StatusCodes.OK,
      { count: ids.length },
      "Messages marked as seen.",
    ).send(res);
  }),
};

export default groupController;
