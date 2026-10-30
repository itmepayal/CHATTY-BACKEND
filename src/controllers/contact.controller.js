import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/api-error.js";
import ApiResponse from "../utils/api-response.js";
import User from "../models/users.model.js";
import Message from "../models/message.model.js";
import Contact from "../models/contact.model.js";
import { toObjectId } from "../utils/message-helpers.js";
import { myId } from "../utils/request-helpers.js";

const contactController = {
  searchUsers: asyncHandler(async (req, res) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return new ApiResponse(
        StatusCodes.OK,
        { users: [] },
        "Type at least 2 characters.",
      ).send(res);
    }

    const me = await User.findById(myId(req)).select("blockedUsers");
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

    const users = await User.find({
      _id: { $ne: myId(req), $nin: me.blockedUsers },
      $or: [{ fullName: rx }, { username: rx }, { email: rx }],
    })
      .select("fullName username avatar")
      .limit(20)
      .lean();

    const mine = await Contact.find({
      ownerId: myId(req),
      contactId: { $in: users.map((u) => u._id) },
    }).select("contactId");
    const set = new Set(mine.map((c) => String(c.contactId)));

    return new ApiResponse(
      StatusCodes.OK,
      { users: users.map((u) => ({ ...u, isContact: set.has(String(u._id)) })) },
      "Users fetched successfully.",
    ).send(res);
  }),

  addContact: asyncHandler(async (req, res) => {
    const { userId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(userId))
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid user ID.");
    if (String(userId) === String(myId(req)))
      throw new ApiError(StatusCodes.BAD_REQUEST, "You can't add yourself.");
    if (!(await User.exists({ _id: userId })))
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    await Contact.updateOne(
      { ownerId: myId(req), contactId: userId },
      { $setOnInsert: { nickname: req.body?.nickname } },
      { upsert: true },
    );

    return new ApiResponse(StatusCodes.CREATED, null, "Contact added.").send(res);
  }),

  removeContact: asyncHandler(async (req, res) => {
    await Contact.deleteOne({
      ownerId: myId(req),
      contactId: req.params.userId,
    });

    return new ApiResponse(StatusCodes.OK, null, "Contact removed.").send(res);
  }),

  getContacts: asyncHandler(async (req, res) => {
    const rows = await Contact.find({ ownerId: myId(req) })
      .populate(
        "contactId",
        "fullName username avatar lastSeen showOnlineStatus",
      )
      .sort({ createdAt: -1 })
      .lean();

    return new ApiResponse(
      StatusCodes.OK,
      {
        contacts: rows
          .filter((r) => r.contactId)
          .map((r) => ({ ...r.contactId, nickname: r.nickname })),
      },
      "Contacts fetched successfully.",
    ).send(res);
  }),

  getChatList: asyncHandler(async (req, res) => {
    const me = toObjectId(myId(req));
    const contacts = await Contact.find({ ownerId: me })
      .select("contactId")
      .lean();
    const ids = contacts.map((c) => c.contactId);

    const last = await Message.aggregate([
      {
        $match: {
          deletedFor: { $ne: me },
          $or: [
            { senderId: me, receiverId: { $in: ids } },
            { receiverId: me, senderId: { $in: ids } },
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

    const users = await User.find({ _id: { $in: ids } })
      .select("fullName username avatar lastSeen showOnlineStatus")
      .lean();

    const chats = users
      .map((u) => {
        const l = byUser.get(String(u._id));
        return {
          user: u,
          lastMessage: l?.lastMessage || null,
          unread: l?.unread || 0,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.lastMessage?.createdAt || 0) -
          new Date(a.lastMessage?.createdAt || 0),
      );

    return new ApiResponse(
      StatusCodes.OK,
      { chats, totalContacts: ids.length },
      "Chat list fetched successfully.",
    ).send(res);
  }),
};

export default contactController;
