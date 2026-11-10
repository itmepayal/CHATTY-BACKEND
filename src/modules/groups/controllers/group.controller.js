import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import { GROUP_SUCCESS_MESSAGES } from "../constants/group.constants.js";
import * as groupService from "../services/group.service.js";
import * as groupMemberService from "../services/group-member.service.js";
import * as groupMessageService from "../services/group-message.service.js";
import * as groupKeyService from "../services/group-key.service.js";
import * as groupShareService from "../services/group-share.service.js";

export const createGroup = asyncHandler(async (req, res) => {
  const payload = await groupMemberService.createGroupWithMembers({
    me: req.user._id,
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
});

export const getMyGroups = asyncHandler(async (req, res) => {
  const result = await groupService.getMyGroupsList(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    result,
    GROUP_SUCCESS_MESSAGES.GROUPS_FETCHED,
  ).send(res);
});

export const getGroup = asyncHandler(async (req, res) => {
  const payload = await groupService.getGroupDetails(
    req.params.id,
    req.user._id,
  );

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.GROUP_FETCHED,
  ).send(res);
});

export const updateGroup = asyncHandler(async (req, res) => {
  const payload = await groupService.updateGroupForRequest({
    groupId: req.params.id,
    me: req.user._id,
    name: req.body.name,
    file: req.file,
  });

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.GROUP_UPDATED,
  ).send(res);
});

export const deleteGroup = asyncHandler(async (req, res) => {
  const payload = await groupService.deleteGroupForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.GROUP_DELETED,
  ).send(res);
});

export const addMembers = asyncHandler(async (req, res) => {
  const payload = await groupMemberService.addMembersForRequest({
    groupId: req.params.id,
    me: req.user._id,
    rawMemberIds: req.body.memberIds,
  });

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.MEMBERS_ADDED,
  ).send(res);
});

export const removeMember = asyncHandler(async (req, res) => {
  const payload = await groupMemberService.removeMemberForRequest({
    groupId: req.params.id,
    me: req.user._id,
    targetId: req.params.userId,
  });

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.MEMBER_REMOVED,
  ).send(res);
});

export const changeRole = asyncHandler(async (req, res) => {
  const payload = await groupMemberService.changeRoleForRequest({
    groupId: req.params.id,
    me: req.user._id,
    targetId: req.params.userId,
    role: req.body.role,
  });

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.ROLE_CHANGED,
  ).send(res);
});

export const leaveGroup = asyncHandler(async (req, res) => {
  const { destroyed } = await groupMemberService.leaveGroupForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  const message = destroyed
    ? GROUP_SUCCESS_MESSAGES.LEFT_AND_DELETED
    : GROUP_SUCCESS_MESSAGES.LEFT_GROUP;

  return new ApiResponse(StatusCodes.OK, null, message).send(res);
});

export const archiveGroup = asyncHandler(async (req, res) => {
  const data = await groupService.archiveGroupForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    GROUP_SUCCESS_MESSAGES.ARCHIVED,
  ).send(res);
});

export const unarchiveGroup = asyncHandler(async (req, res) => {
  const data = await groupService.unarchiveGroupForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    GROUP_SUCCESS_MESSAGES.UNARCHIVED,
  ).send(res);
});

export const getMyGroupKeys = asyncHandler(async (req, res) => {
  const data = await groupKeyService.getMyKeysForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  return new ApiResponse(
    StatusCodes.OK,
    data,
    GROUP_SUCCESS_MESSAGES.KEYS_FETCHED,
  ).send(res);
});

export const getPendingKeyMembers = asyncHandler(async (req, res) => {
  const result = await groupKeyService.getPendingKeyMembersForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  const message = result.notEncrypted
    ? GROUP_SUCCESS_MESSAGES.GROUP_NOT_ENCRYPTED
    : GROUP_SUCCESS_MESSAGES.PENDING_KEY_MEMBERS;

  return new ApiResponse(
    StatusCodes.OK,
    { latestVersion: result.latestVersion, pending: result.pending },
    message,
  ).send(res);
});

export const setGroupKeys = asyncHandler(async (req, res) => {
  const payload = await groupKeyService.setGroupKeysForRequest({
    groupId: req.params.id,
    me: req.user._id,
    keys: req.body.keys,
    version: req.body.version,
  });

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.KEYS_UPDATED,
  ).send(res);
});

export const getGroupMessages = asyncHandler(async (req, res) => {
  const msgs = await groupMessageService.getGroupMessagesForRequest({
    groupId: req.params.id,
    me: req.user._id,
    query: req.query,
  });

  return new ApiResponse(
    StatusCodes.OK,
    msgs,
    GROUP_SUCCESS_MESSAGES.MESSAGES_FETCHED,
  ).send(res);
});

export const sendGroupMessage = asyncHandler(async (req, res) => {
  const result = await groupMessageService.sendGroupMessageForRequest({
    groupId: req.params.id,
    me: req.user._id,
    body: req.body,
    file: req.file,
  });

  const statusCode = result.isDuplicate ? StatusCodes.OK : StatusCodes.CREATED;
  const message = result.isDuplicate
    ? GROUP_SUCCESS_MESSAGES.MESSAGE_ALREADY_SENT
    : GROUP_SUCCESS_MESSAGES.MESSAGE_SENT;

  return new ApiResponse(statusCode, result.payload, message).send(res);
});

export const editGroupMessage = asyncHandler(async (req, res) => {
  const result = await groupMessageService.editGroupMessageForRequest({
    groupId: req.params.id,
    me: req.user._id,
    messageId: req.params.messageId,
    body: req.body,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result.payload,
    GROUP_SUCCESS_MESSAGES.MESSAGE_EDITED,
  ).send(res);
});

export const deleteGroupMessage = asyncHandler(async (req, res) => {
  const payload = await groupMessageService.deleteGroupMessageForRequest({
    groupId: req.params.id,
    me: req.user._id,
    messageId: req.params.messageId,
  });

  return new ApiResponse(
    StatusCodes.OK,
    payload,
    GROUP_SUCCESS_MESSAGES.MESSAGE_DELETED,
  ).send(res);
});

export const markGroupSeen = asyncHandler(async (req, res) => {
  const result = await groupMessageService.markGroupSeenForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  return new ApiResponse(
    StatusCodes.OK,
    { count: result.count },
    GROUP_SUCCESS_MESSAGES.MESSAGES_SEEN,
  ).send(res);
});

export const startGroupShare = asyncHandler(async (req, res) => {
  const result = await groupShareService.startGroupShareForRequest({
    groupId: req.params.id,
    me: req.user._id,
    body: req.body,
  });

  const statusCode = result.isDuplicate ? StatusCodes.OK : StatusCodes.CREATED;
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
});

export const updateGroupShare = asyncHandler(async (req, res) => {
  const result = await groupShareService.updateGroupShareForRequest({
    groupId: req.params.id,
    me: req.user._id,
    shareId: req.params.shareId,
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
});

export const stopGroupShare = asyncHandler(async (req, res) => {
  const result = await groupShareService.stopGroupShareForRequest({
    groupId: req.params.id,
    me: req.user._id,
    shareId: req.params.shareId,
  });

  return new ApiResponse(
    StatusCodes.OK,
    { shareId: result.shareId },
    GROUP_SUCCESS_MESSAGES.LIVE_LOCATION_STOPPED,
  ).send(res);
});

export const getActiveGroupShares = asyncHandler(async (req, res) => {
  const result = await groupShareService.getActiveGroupSharesForRequest({
    groupId: req.params.id,
    me: req.user._id,
  });

  return new ApiResponse(
    StatusCodes.OK,
    { mine: result.mine, inGroup: result.inGroup },
    GROUP_SUCCESS_MESSAGES.ACTIVE_SHARES_FETCHED,
  ).send(res);
});

const groupController = {
  createGroup,
  getMyGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  addMembers,
  removeMember,
  changeRole,
  leaveGroup,
  archiveGroup,
  unarchiveGroup,
  getMyGroupKeys,
  getPendingKeyMembers,
  setGroupKeys,
  getGroupMessages,
  sendGroupMessage,
  editGroupMessage,
  deleteGroupMessage,
  markGroupSeen,
  startGroupShare,
  updateGroupShare,
  stopGroupShare,
  getActiveGroupShares,
};

export default groupController;
