import { StatusCodes } from "http-status-codes";
import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../../../shared/responses/api-response.js";
import * as groupInviteService from "../services/group-invite.service.js";

export const createGroupInvite = asyncHandler(async (req, res) => {
  const { userId } = req.body;
  const groupId = req.params.id;
  const invite = await groupInviteService.createGroupInvite(groupId, req.user._id, userId);
  return new ApiResponse(
    StatusCodes.CREATED,
    invite,
    "Group invitation sent successfully.",
  ).send(res);
});

export const getMyGroupInvites = asyncHandler(async (req, res) => {
  const invites = await groupInviteService.getMyGroupInvites(req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    invites,
    "Pending group invitations retrieved.",
  ).send(res);
});

export const acceptGroupInvite = asyncHandler(async (req, res) => {
  const result = await groupInviteService.acceptGroupInvite(req.params.inviteId, req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Joined group successfully via invitation.",
  ).send(res);
});

export const declineGroupInvite = asyncHandler(async (req, res) => {
  const result = await groupInviteService.declineGroupInvite(req.params.inviteId, req.user._id);
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Group invitation declined.",
  ).send(res);
});
