import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import { CONTACT_SUCCESS_MESSAGES } from "../constants/contact.constants.js";
import * as contactService from "../services/contact.service.js";

export const searchUsers = asyncHandler(async (req, res) => {
  const result = await contactService.searchUsers(req.user._id, req.query.q);

  return new ApiResponse(
    StatusCodes.OK,
    { users: result.users },
    result.message,
  ).send(res);
});

export const getContacts = asyncHandler(async (req, res) => {
  const result = await contactService.getContacts(req.user._id, {
    page: req.query.page,
    limit: req.query.limit,
    search: req.query.search,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result,
    CONTACT_SUCCESS_MESSAGES.CONTACTS_FETCHED,
  ).send(res);
});

export const getChatList = asyncHandler(async (req, res) => {
  const result = await contactService.getChatList(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    result,
    CONTACT_SUCCESS_MESSAGES.CHAT_LIST_FETCHED,
  ).send(res);
});

export const getContactById = asyncHandler(async (req, res) => {
  const contact = await contactService.getContactById(
    req.user._id,
    req.params.userId,
  );

  return new ApiResponse(
    StatusCodes.OK,
    contact,
    CONTACT_SUCCESS_MESSAGES.CONTACT_FETCHED,
  ).send(res);
});

export const addContact = asyncHandler(async (req, res) => {
  const data = await contactService.addContact(
    req.user._id,
    req.params.userId,
    req.body?.nickname,
  );

  return new ApiResponse(
    StatusCodes.CREATED,
    data,
    CONTACT_SUCCESS_MESSAGES.CONTACT_ADDED,
  ).send(res);
});

export const removeContact = asyncHandler(async (req, res) => {
  const data = await contactService.removeContact(
    req.user._id,
    req.params.userId,
  );

  return new ApiResponse(
    StatusCodes.OK,
    data,
    CONTACT_SUCCESS_MESSAGES.CONTACT_REMOVED,
  ).send(res);
});

export const updateContactNickname = asyncHandler(async (req, res) => {
  const data = await contactService.updateContactNickname(
    req.user._id,
    req.params.userId,
    req.body?.nickname,
  );

  return new ApiResponse(
    StatusCodes.OK,
    data,
    CONTACT_SUCCESS_MESSAGES.NICKNAME_UPDATED,
  ).send(res);
});

export const getMutualContacts = asyncHandler(async (req, res) => {
  const mutualContacts = await contactService.getMutualContacts(
    req.user._id,
    req.params.otherUserId,
  );

  return new ApiResponse(
    StatusCodes.OK,
    { mutualContacts },
    CONTACT_SUCCESS_MESSAGES.MUTUAL_FETCHED,
  ).send(res);
});

export const getContactCount = asyncHandler(async (req, res) => {
  const data = await contactService.getContactCount(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    CONTACT_SUCCESS_MESSAGES.COUNT_FETCHED,
  ).send(res);
});

export const bulkAddContacts = asyncHandler(async (req, res) => {
  const result = await contactService.bulkAddContacts(
    req.user._id,
    req.body?.contactIds,
  );

  return new ApiResponse(
    StatusCodes.CREATED,
    result,
    CONTACT_SUCCESS_MESSAGES.BULK_PROCESSED,
  ).send(res);
});

const contactController = {
  searchUsers,
  getContacts,
  getChatList,
  getContactById,
  addContact,
  removeContact,
  updateContactNickname,
  getMutualContacts,
  getContactCount,
  bulkAddContacts,
};

export default contactController;
