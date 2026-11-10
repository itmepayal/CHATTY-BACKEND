import { z } from "zod";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import { isValidObjectId } from "../utils/object-id.util.js";
import {
  MAX_NICKNAME_LENGTH,
  MAX_BULK_CONTACTS,
  CONTACT_ERROR_MESSAGES,
} from "../constants/contact.constants.js";
import { objectIdSchema } from "./common.validation.js";

export const userIdParamSchema = z.object({
  userId: objectIdSchema,
});

export const otherUserIdParamSchema = z.object({
  otherUserId: objectIdSchema,
});

export const addContactBodySchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .max(MAX_NICKNAME_LENGTH, CONTACT_ERROR_MESSAGES.INVALID_NICKNAME)
      .optional()
      .nullable(),
  })
  .passthrough();

export const updateNicknameBodySchema = z
  .object({
    nickname: z
      .string()
      .trim()
      .max(MAX_NICKNAME_LENGTH, CONTACT_ERROR_MESSAGES.INVALID_NICKNAME)
      .optional()
      .nullable(),
  })
  .passthrough();

export const contactPaginationQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .min(1, "Page must be a positive integer.")
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, "Limit must be a positive integer.")
      .optional(),
    search: z.string().optional(),
  })
  .passthrough();

export const bulkAddBodySchema = z
  .object({
    contactIds: z
      .array(objectIdSchema, {
        required_error: CONTACT_ERROR_MESSAGES.INVALID_BULK_ARRAY,
      })
      .min(1, CONTACT_ERROR_MESSAGES.INVALID_BULK_ARRAY)
      .max(MAX_BULK_CONTACTS, CONTACT_ERROR_MESSAGES.EXCEEDED_BULK_LIMIT),
  })
  .passthrough();

export const validateUserIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.userId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }
  next();
};

export const validateOtherUserIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.otherUserId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CONTACT_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }
  next();
};

export const validateAddContactBody = (req, _res, next) => {
  const { nickname } = req.body || {};
  if (nickname !== undefined && nickname !== null) {
    if (
      typeof nickname !== "string" ||
      nickname.trim().length > MAX_NICKNAME_LENGTH
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        CONTACT_ERROR_MESSAGES.INVALID_NICKNAME,
      );
    }
  }
  next();
};

export const validateUpdateNicknameBody = (req, _res, next) => {
  const { nickname } = req.body || {};
  if (nickname !== undefined && nickname !== null) {
    if (
      typeof nickname !== "string" ||
      nickname.trim().length > MAX_NICKNAME_LENGTH
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        CONTACT_ERROR_MESSAGES.INVALID_NICKNAME,
      );
    }
  }
  next();
};

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
