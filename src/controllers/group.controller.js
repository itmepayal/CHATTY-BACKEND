import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { getPrivacy } from "../lib/socket-state.js";
import { parseKeyEntries } from "../utils/e2ee.js";
import { getGroupAndMember, assertAdmin } from "../utils/group-guard.js";
import { GROUP_SUCCESS_MESSAGES } from "../constants/group.constants.js";
import {
  getMyGroupsList,
  getGroupDetails,
  updateGroupService,
  deleteGroupService,
  archiveGroupService,
  unarchiveGroupService,
} from "../services/group.service.js";
import {
  getGroupMessagesList,
  sendGroupMessageService,
  editGroupMessageService,
  deleteGroupMessageService,
  markGroupSeenService,
} from "../services/group-message.service.js";
import {
  createGroupWithMembers,
  addMembersToGroup,
  removeMemberFromGroup,
  changeMemberRole,
  leaveGroupFlow,
} from "../services/group-member.service.js";
import {
  getMyKeysPayload,
  getPendingKeyMembersPayload,
  applyGroupKeys,
} from "../services/group-key.service.js";
import {
  startGroupShareService,
  updateGroupShareService,
  stopGroupShareService,
  getActiveGroupSharesService,
} from "../services/group-share.service.js";

const groupController = {
  createGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const payload = await createGroupWithMembers({
      me,
      name: req.body.name,
      rawMemberIds: req.body.memberIds,
      file: req.file,
      e2ee: req.body.e2ee,
      keys: req.body.keys,
    });
    return new ApiResponse(
      StatusCodes.CREATED,
      payload,
      GROUP_SUCCESS_MESSAGES.GROUP_CREATED,
    ).send(res);
  }),

  getMyGroups: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const result = await getMyGroupsList(me);
    return new ApiResponse(
      StatusCodes.OK,
      result,
      GROUP_SUCCESS_MESSAGES.GROUPS_FETCHED,
    ).send(res);
  }),

  getGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const payload = await getGroupDetails(req.params.id, me);
    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.GROUP_FETCHED,
    ).send(res);
  }),

  updateGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    const payload = await updateGroupService({
      group,
      me,
      name: req.body.name,
      file: req.file,
    });

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.GROUP_UPDATED,
    ).send(res);
  }),

  deleteGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    const payload = await deleteGroupService(group, me);
    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.GROUP_DELETED,
    ).send(res);
  }),

  addMembers: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    assertAdmin(member);

    const payload = await addMembersToGroup({
      group,
      me,
      rawMemberIds: req.body.memberIds,
    });

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.MEMBERS_ADDED,
    ).send(res);
  }),

  removeMember: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { group } = await getGroupAndMember(req.params.id, me);

    const payload = await removeMemberFromGroup({ group, me, targetId });
    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.MEMBER_REMOVED,
    ).send(res);
  }),

  changeRole: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const targetId = req.params.userId;
    const { group } = await getGroupAndMember(req.params.id, me);

    const payload = await changeMemberRole({
      group,
      me,
      targetId,
      role: req.body.role,
    });

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.ROLE_CHANGED,
    ).send(res);
  }),

  leaveGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    const { destroyed } = await leaveGroupFlow({ group, me });

    const message = destroyed
      ? GROUP_SUCCESS_MESSAGES.LEFT_AND_DELETED
      : GROUP_SUCCESS_MESSAGES.LEFT_GROUP;

    return new ApiResponse(StatusCodes.OK, null, message).send(res);
  }),

  archiveGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    await archiveGroupService(group, me);
    return new ApiResponse(
      StatusCodes.OK,
      { groupId: String(group._id), archived: true },
      GROUP_SUCCESS_MESSAGES.ARCHIVED,
    ).send(res);
  }),

  unarchiveGroup: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    await unarchiveGroupService(group, me);
    return new ApiResponse(
      StatusCodes.OK,
      { groupId: String(group._id), archived: false },
      GROUP_SUCCESS_MESSAGES.UNARCHIVED,
    ).send(res);
  }),

  getMyGroupKeys: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    const data = await getMyKeysPayload(group, me);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      GROUP_SUCCESS_MESSAGES.KEYS_FETCHED,
    ).send(res);
  }),

  getPendingKeyMembers: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    const result = await getPendingKeyMembersPayload(group);

    const message = result.notEncrypted
      ? GROUP_SUCCESS_MESSAGES.GROUP_NOT_ENCRYPTED
      : GROUP_SUCCESS_MESSAGES.PENDING_KEY_MEMBERS;

    return new ApiResponse(
      StatusCodes.OK,
      { latestVersion: result.latestVersion, pending: result.pending },
      message,
    ).send(res);
  }),

  setGroupKeys: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const entries = parseKeyEntries(req.body.keys, req.body.version);
    const payload = await applyGroupKeys({ group, member, entries, me });
    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.KEYS_UPDATED,
    ).send(res);
  }),

  getGroupMessages: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const msgs = await getGroupMessagesList({
      group,
      member,
      me,
      query: req.query,
    });
    return new ApiResponse(
      StatusCodes.OK,
      msgs,
      GROUP_SUCCESS_MESSAGES.MESSAGES_FETCHED,
    ).send(res);
  }),

  sendGroupMessage: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);
    const result = await sendGroupMessageService({
      group,
      me,
      body: req.body,
      file: req.file,
    });

    const statusCode = result.isDuplicate
      ? StatusCodes.OK
      : StatusCodes.CREATED;
    const message = result.isDuplicate
      ? GROUP_SUCCESS_MESSAGES.MESSAGE_ALREADY_SENT
      : GROUP_SUCCESS_MESSAGES.MESSAGE_SENT;

    return new ApiResponse(statusCode, result.payload, message).send(res);
  }),

  editGroupMessage: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { id: groupId, messageId } = req.params;
    const { group } = await getGroupAndMember(groupId, me);

    const result = await editGroupMessageService({
      group,
      me,
      messageId,
      body: req.body,
    });

    return new ApiResponse(
      StatusCodes.OK,
      result.payload,
      GROUP_SUCCESS_MESSAGES.MESSAGE_EDITED,
    ).send(res);
  }),

  deleteGroupMessage: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { id: groupId, messageId } = req.params;
    const { group, member } = await getGroupAndMember(groupId, me);

    const payload = await deleteGroupMessageService({
      group,
      member,
      me,
      messageId,
    });

    return new ApiResponse(
      StatusCodes.OK,
      payload,
      GROUP_SUCCESS_MESSAGES.MESSAGE_DELETED,
    ).send(res);
  }),

  markGroupSeen: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group, member } = await getGroupAndMember(req.params.id, me);
    const privacy = getPrivacy(String(me)) || {};
    const readReceipts = privacy.readReceipts !== false;

    const result = await markGroupSeenService({
      group,
      member,
      me,
      readReceipts,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { count: result.count },
      GROUP_SUCCESS_MESSAGES.MESSAGES_SEEN,
    ).send(res);
  }),

  startGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const result = await startGroupShareService({
      group,
      me,
      body: req.body,
    });

    const statusCode = result.isDuplicate
      ? StatusCodes.OK
      : StatusCodes.CREATED;
    let message = GROUP_SUCCESS_MESSAGES.LOCATION_SENT;
    if (result.isDuplicate) {
      message =
        result.mode === "live"
          ? GROUP_SUCCESS_MESSAGES.LIVE_LOCATION_ALREADY_STARTED
          : GROUP_SUCCESS_MESSAGES.LOCATION_ALREADY_SENT;
    } else if (result.mode === "live") {
      message = GROUP_SUCCESS_MESSAGES.LIVE_LOCATION_STARTED;
    }

    return new ApiResponse(statusCode, result.data, message).send(res);
  }),

  updateGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { shareId } = req.params;
    const { group } = await getGroupAndMember(req.params.id, me);

    const result = await updateGroupShareService({
      group,
      me,
      shareId,
      body: req.body,
    });

    if (result.skipped) {
      return new ApiResponse(
        StatusCodes.OK,
        { shareId: result.shareId, skipped: true },
        GROUP_SUCCESS_MESSAGES.LOCATION_UPDATE_SKIPPED,
      ).send(res);
    }

    return new ApiResponse(
      StatusCodes.OK,
      result.locationPayload,
      GROUP_SUCCESS_MESSAGES.LOCATION_UPDATED,
    ).send(res);
  }),

  stopGroupShare: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { shareId } = req.params;
    const { group, member } = await getGroupAndMember(req.params.id, me);

    const result = await stopGroupShareService({
      group,
      member,
      me,
      shareId,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { shareId: result.shareId },
      GROUP_SUCCESS_MESSAGES.LIVE_LOCATION_STOPPED,
    ).send(res);
  }),

  getActiveGroupShares: asyncHandler(async (req, res) => {
    const me = req.user._id;
    const { group } = await getGroupAndMember(req.params.id, me);

    const result = await getActiveGroupSharesService({
      group,
      me,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { mine: result.mine, inGroup: result.inGroup },
      GROUP_SUCCESS_MESSAGES.ACTIVE_SHARES_FETCHED,
    ).send(res);
  }),
};

export default groupController;
