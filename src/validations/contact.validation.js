import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import { isValidObjectId } from "../utils/object-id.util.js";
import {
  MAX_NICKNAME_LENGTH,
  MAX_BULK_CONTACTS,
  CONTACT_ERROR_MESSAGES,
} from "../constants/contact.constants.js";

/**
 * Validates request parameter :userId
 */
export const validateUserIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.userId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }
  next();
};

/**
 * Validates request parameter :otherUserId
 */
export const validateOtherUserIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.otherUserId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }
  next();
};

/**
 * Validates request body for adding a contact
 */
export const validateAddContactBody = (req, _res, next) => {
  const { nickname } = req.body || {};
  if (nickname !== undefined && nickname !== null) {
    if (typeof nickname !== "string") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        CONTACT_ERROR_MESSAGES.INVALID_NICKNAME,
      );
    }
    if (nickname.trim().length > MAX_NICKNAME_LENGTH) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        CONTACT_ERROR_MESSAGES.INVALID_NICKNAME,
      );
    }
  }
  next();
};

/**
 * Validates request body for updating contact nickname
 */
export const validateUpdateNicknameBody = (req, _res, next) => {
  const { nickname } = req.body || {};
  if (nickname !== undefined && nickname !== null) {
    if (typeof nickname !== "string") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        CONTACT_ERROR_MESSAGES.INVALID_NICKNAME,
      );
    }
    if (nickname.trim().length > MAX_NICKNAME_LENGTH) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        CONTACT_ERROR_MESSAGES.INVALID_NICKNAME,
      );
    }
  }
  next();
};

/**
 * Validates request query for pagination and search
 */
export const validatePaginationQuery = (req, _res, next) => {
  const { page, limit } = req.query;
  if (page !== undefined) {
    const p = Number(page);
    if (!Number.isInteger(p) || p < 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Page must be a positive integer.",
      );
    }
  }
  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Limit must be a positive integer.",
      );
    }
  }
  next();
};

/**
 * Validates request body for bulk contact addition
 */
export const validateBulkAddBody = (req, _res, next) => {
  const { contactIds } = req.body || {};
  if (!Array.isArray(contactIds) || contactIds.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.INVALID_BULK_ARRAY,
    );
  }
  if (contactIds.length > MAX_BULK_CONTACTS) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.EXCEEDED_BULK_LIMIT,
    );
  }
  next();
};
