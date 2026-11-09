import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { myId } from "../utils/request-helpers.js";
import * as contactService from "../services/contact.service.js";
import { CONTACT_SUCCESS_MESSAGES } from "../constants/contact.constants.js";

const contactController = {
  searchUsers: asyncHandler(async (req, res) => {
    const { q } = req.query;
    const result = await contactService.searchUsers(myId(req), q);

    return new ApiResponse(
      StatusCodes.OK,
      { users: result.users },
      result.message,
    ).send(res);
  }),

  getContacts: asyncHandler(async (req, res) => {
    const { page, limit, search } = req.query;
    const result = await contactService.getContacts(myId(req), {
      page,
      limit,
      search,
    });

    return new ApiResponse(
      StatusCodes.OK,
      result,
      CONTACT_SUCCESS_MESSAGES.CONTACTS_FETCHED,
    ).send(res);
  }),

  getChatList: asyncHandler(async (req, res) => {
    const result = await contactService.getChatList(myId(req));

    return new ApiResponse(
      StatusCodes.OK,
      result,
      CONTACT_SUCCESS_MESSAGES.CHAT_LIST_FETCHED,
    ).send(res);
  }),

  getContactById: asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const contact = await contactService.getContactById(myId(req), userId);

    return new ApiResponse(
      StatusCodes.OK,
      contact,
      CONTACT_SUCCESS_MESSAGES.CONTACT_FETCHED,
    ).send(res);
  }),

  addContact: asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { nickname } = req.body || {};
    const data = await contactService.addContact(myId(req), userId, nickname);

    return new ApiResponse(
      StatusCodes.CREATED,
      data,
      CONTACT_SUCCESS_MESSAGES.CONTACT_ADDED,
    ).send(res);
  }),

  removeContact: asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const data = await contactService.removeContact(myId(req), userId);

    return new ApiResponse(
      StatusCodes.OK,
      data,
      CONTACT_SUCCESS_MESSAGES.CONTACT_REMOVED,
    ).send(res);
  }),

  updateContactNickname: asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { nickname } = req.body || {};
    const data = await contactService.updateContactNickname(
      myId(req),
      userId,
      nickname,
    );

    return new ApiResponse(
      StatusCodes.OK,
      data,
      CONTACT_SUCCESS_MESSAGES.NICKNAME_UPDATED,
    ).send(res);
  }),

  getMutualContacts: asyncHandler(async (req, res) => {
    const { otherUserId } = req.params;
    const mutualContacts = await contactService.getMutualContacts(
      myId(req),
      otherUserId,
    );

    return new ApiResponse(
      StatusCodes.OK,
      { mutualContacts },
      CONTACT_SUCCESS_MESSAGES.MUTUAL_FETCHED,
    ).send(res);
  }),

  getContactCount: asyncHandler(async (req, res) => {
    const data = await contactService.getContactCount(myId(req));

    return new ApiResponse(
      StatusCodes.OK,
      data,
      CONTACT_SUCCESS_MESSAGES.COUNT_FETCHED,
    ).send(res);
  }),

  bulkAddContacts: asyncHandler(async (req, res) => {
    const { contactIds } = req.body || {};
    const result = await contactService.bulkAddContacts(myId(req), contactIds);

    return new ApiResponse(
      StatusCodes.CREATED,
      result,
      CONTACT_SUCCESS_MESSAGES.BULK_PROCESSED,
    ).send(res);
  }),
};

export default contactController;
