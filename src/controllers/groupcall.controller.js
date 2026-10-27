import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/apiResponse.js";
import Group from "../models/group.model.js";
import GroupCall from "../models/groupcall.model.js";
import { getGroupAndMember } from "../utils/groupguard.js";

const sid = (x) => String(x?._id ?? x);

const formatGroupCall = (c, meId) => ({
  id: c._id,
  groupId: sid(c.groupId),
  type: c.type,
  status: c.status,
  duration: c.duration,
  startedAt: c.startedAt,
  endedAt: c.endedAt,
  participantCount: c.participants?.length || 0,
  maxParticipants: c.maxParticipants,
  startedByMe: sid(c.startedBy) === String(meId),
  startedBy: c.startedBy?._id
    ? {
        id: sid(c.startedBy),
        fullName: c.startedBy.fullName,
        avatar: c.startedBy.avatar?.url || "",
      }
    : { id: sid(c.startedBy) },
});

const groupCallController = {
  getGroupCallHistory: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const calls = await GroupCall.find({
      groupId: group._id,
      startedAt: { $gte: member.joinedAt },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate("startedBy", "fullName avatar");

    return new ApiResponse(
      StatusCodes.OK,
      calls.map((c) => formatGroupCall(c, me)),
      "Group call history fetched successfully.",
    ).send(res);
  }),

  getMyGroupCalls: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const groups = await Group.find({ "members.userId": me })
      .select("name avatar members.userId members.joinedAt")
      .lean();

    const byId = new Map(
      groups.map((g) => {
        const mine = g.members.find((m) => sid(m.userId) === String(me));
        return [
          sid(g._id),
          {
            name: g.name,
            avatar: g.avatar?.url || "",
            joinedAt: mine?.joinedAt,
          },
        ];
      }),
    );

    const calls = await GroupCall.find({ groupId: { $in: [...byId.keys()] } })
      .sort({ createdAt: -1 })
      .limit(limit * 2)
      .populate("startedBy", "fullName avatar");

    const data = calls
      .filter((c) => {
        const g = byId.get(sid(c.groupId));
        return g && (!g.joinedAt || c.startedAt >= g.joinedAt);
      })
      .slice(0, limit)
      .map((c) => ({
        ...formatGroupCall(c, me),
        group: { id: sid(c.groupId), ...byId.get(sid(c.groupId)) },
      }));

    return new ApiResponse(
      StatusCodes.OK,
      data,
      "Group calls fetched successfully.",
    ).send(res);
  }),
};

export default groupCallController;
