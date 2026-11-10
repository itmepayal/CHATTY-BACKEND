import mongoose from "mongoose";
import ApiError from "./api-error.js";
import { StatusCodes } from "http-status-codes";
import { CONTACT_ERROR_MESSAGES } from "../constants/contacts/contact.constants.js";

/**
 * Validates whether a value is a valid 24-character hex MongoDB ObjectId.
 * @param {any} id
 * @returns {boolean}
 */
export const isValidObjectId = (id) =>
  Boolean(
    id &&
      mongoose.Types.ObjectId.isValid(id) &&
      String(new mongoose.Types.ObjectId(id)) === String(id),
  );

/**
 * Converts a string or ObjectId into a Mongoose ObjectId instance.
 * @param {string|mongoose.Types.ObjectId} id
 * @returns {mongoose.Types.ObjectId}
 */
export const toObjectId = (id) =>
  id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(id);

/**
 * Asserts that an ID is a valid ObjectId, throwing ApiError if invalid.
 * @param {any} id
 * @param {string} [customMessage]
 * @throws {ApiError}
 */
export const assertValidObjectId = (
  id,
  customMessage = CONTACT_ERROR_MESSAGES.INVALID_USER_ID,
) => {
  if (!isValidObjectId(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, customMessage);
  }
};
