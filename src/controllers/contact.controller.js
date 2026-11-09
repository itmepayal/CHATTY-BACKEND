import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { myId } from "../utils/request-helpers.js";
import * as contactService from "../services/contact.service.js";

export const searchUsers = asyncHandler(async (req, res) => {
  const result = await contactService.searchUsers(myId(req), req.query.q);
  return new ApiResponse(
    StatusCodes.OK,
    { users: result.users },
    result.message,
  ).send(res, { users: result.users });
});

export const getContacts = asyncHandler(async (req, res) => {
  const result = await contactService.getContacts(myId(req), req.query);
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Contacts fetched successfully.",
  ).send(res, { contacts: result.contacts });
});

export const getChatList = asyncHandler(async (req, res) => {
  const result = await contactService.getChatList(myId(req));
  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Chat list fetched successfully.",
  ).send(res);
});

export const getContactById = asyncHandler(async (req, res) => {
  const contact = await contactService.getContactById(
    myId(req),
    req.params.userId,
  );
  return new ApiResponse(
    StatusCodes.OK,
    contact,
    "Contact fetched successfully.",
  ).send(res);
});

export const addContact = asyncHandler(async (req, res) => {
  const data = await contactService.addContact(
    myId(req),
    req.params.userId,
    req.body?.nickname,
  );
  return new ApiResponse(StatusCodes.CREATED, data, "Contact added.").send(res);
});

export const removeContact = asyncHandler(async (req, res) => {
  const data = await contactService.removeContact(myId(req), req.params.userId);
  return new ApiResponse(StatusCodes.OK, data, "Contact removed.").send(res);
});

export const updateContactNickname = asyncHandler(async (req, res) => {
  const data = await contactService.updateContactNickname(
    myId(req),
    req.params.userId,
    req.body?.nickname,
  );
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Contact nickname updated.",
  ).send(res);
});

export const getMutualContacts = asyncHandler(async (req, res) => {
  const mutualContacts = await contactService.getMutualContacts(
    myId(req),
    req.params.otherUserId,
  );
  return new ApiResponse(
    StatusCodes.OK,
    { mutualContacts },
    "Mutual contacts fetched successfully.",
  ).send(res, { mutualContacts });
});

export const getContactCount = asyncHandler(async (req, res) => {
  const data = await contactService.getContactCount(myId(req));
  return new ApiResponse(
    StatusCodes.OK,
    data,
    "Contact count fetched successfully.",
  ).send(res);
});

export const bulkAddContacts = asyncHandler(async (req, res) => {
  const result = await contactService.bulkAddContacts(
    myId(req),
    req.body?.contactIds,
  );
  return new ApiResponse(
    StatusCodes.CREATED,
    result,
    "Bulk contacts processed.",
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
