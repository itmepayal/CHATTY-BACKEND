import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../utils/api-response.js";
import {
  chatSettingService,
  reportService,
  scheduleService,
  locationService,
  queryService,
  lifecycleService,
  forwardService,
  deliveryService,
  sendService,
  sidebarService,
} from "../services/messaging/index.js";

const messageController = {
  getUsersForSidebar: asyncHandler(async (req, res) => {
    const { response, message } = await sidebarService.getUsersForSidebar(
      req.user._id,
      req.query,
    );
    return new ApiResponse(StatusCodes.OK, response, message).send(res);
  }),

  getMessage: asyncHandler(async (req, res) => {
    const { messages, message } = await queryService.getMessages(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, messages, message).send(res);
  }),

  sendMessage: asyncHandler(async (req, res) => {
    const { status, payload, message } = await sendService.sendMessage(
      req.user._id,
      req.params.id,
      req.body,
      req.file,
    );
    return new ApiResponse(status, payload, message).send(res);
  }),

  forwardMessage: asyncHandler(async (req, res) => {
    const { sent, message } = await forwardService.forwardMessage(
      req.user._id,
      req.params.messageId,
      req.body,
    );
    return new ApiResponse(StatusCodes.OK, sent, message).send(res);
  }),

  editMessage: asyncHandler(async (req, res) => {
    const { payload, message } = await lifecycleService.editMessage(
      req.user._id,
      req.params.messageId,
      req.body,
    );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
  }),

  togglePin: asyncHandler(async (req, res) => {
    const { payload, message } = await lifecycleService.togglePin(
      req.user._id,
      req.params.messageId,
    );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
  }),

  getPinned: asyncHandler(async (req, res) => {
    const { pinned, message } = await queryService.getPinned(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, pinned, message).send(res);
  }),

  searchMessages: asyncHandler(async (req, res) => {
    const { results, message } = await queryService.searchMessages(
      req.user._id,
      req.params.id,
      req.query,
    );
    return new ApiResponse(StatusCodes.OK, results, message).send(res);
  }),

  scheduleMessage: asyncHandler(async (req, res) => {
    const { doc, message } = await scheduleService.scheduleMessage(
      req.user._id,
      req.params.id,
      req.body,
    );
    return new ApiResponse(StatusCodes.CREATED, doc, message).send(res);
  }),

  getScheduled: asyncHandler(async (req, res) => {
    const { list, message } = await scheduleService.getScheduled(
      req.user._id,
      req.query,
    );
    return new ApiResponse(StatusCodes.OK, list, message).send(res);
  }),

  cancelScheduled: asyncHandler(async (req, res) => {
    const { id, message } = await scheduleService.cancelScheduled(
      req.user._id,
      req.params.scheduleId,
    );
    return new ApiResponse(StatusCodes.OK, { id }, message).send(res);
  }),

  markMessagesSeen: asyncHandler(async (req, res) => {
    const { count, message } = await deliveryService.markMessagesSeen(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, { count }, message).send(res);
  }),

  reactMessage: asyncHandler(async (req, res) => {
    const { payload, message } = await lifecycleService.reactMessage(
      req.user._id,
      req.params.messageId,
      req.body.emoji,
    );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
  }),

  deleteMessageForMe: asyncHandler(async (req, res) => {
    const { messageId, message } = await lifecycleService.deleteMessageForMe(
      req.user._id,
      req.params.messageId,
    );
    return new ApiResponse(StatusCodes.OK, { messageId }, message).send(res);
  }),

  deleteMessageForEveryone: asyncHandler(async (req, res) => {
    const { payload, message } =
      await lifecycleService.deleteMessageForEveryone(
        req.user._id,
        req.params.messageId,
      );
    return new ApiResponse(StatusCodes.OK, payload, message).send(res);
  }),

  reportUser: asyncHandler(async (req, res) => {
    const { message } = await reportService.reportUser(
      req.user._id,
      req.params.id,
      req.body,
    );
    return new ApiResponse(StatusCodes.CREATED, null, message).send(res);
  }),

  getDisappearing: asyncHandler(async (req, res) => {
    const { seconds } = await chatSettingService.getDisappearing(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(
      StatusCodes.OK,
      { seconds },
      "Disappearing setting.",
    ).send(res);
  }),

  setDisappearing: asyncHandler(async (req, res) => {
    const { seconds, message } = await chatSettingService.setDisappearing(
      req.user._id,
      req.params.id,
      req.body.seconds,
    );
    return new ApiResponse(StatusCodes.OK, { seconds }, message).send(res);
  }),

  setArchive: asyncHandler(async (req, res) => {
    const { userId, archived, message } = await chatSettingService.setArchive(
      req.user._id,
      req.params.id,
      req.body.archived,
    );
    return new ApiResponse(StatusCodes.OK, { userId, archived }, message).send(
      res,
    );
  }),

  startShare: asyncHandler(async (req, res) => {
    const { status, data, message } = await locationService.startShare(
      req.user._id,
      req.body,
    );
    return new ApiResponse(status, data, message).send(res);
  }),

  stopShare: asyncHandler(async (req, res) => {
    const { shareId, message } = await locationService.stopShare(
      req.user._id,
      req.params.id,
    );
    return new ApiResponse(StatusCodes.OK, { shareId }, message).send(res);
  }),

  getActiveShares: asyncHandler(async (req, res) => {
    const { mine, forMe, message } = await locationService.getActiveShares(
      req.user._id,
    );
    return new ApiResponse(StatusCodes.OK, { mine, forMe }, message).send(res);
  }),
};

export default messageController;
