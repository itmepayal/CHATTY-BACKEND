import { z } from "zod";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import { isValidObjectId } from "../utils/object-id.util.js";
import { CALL_ERROR_MESSAGES } from "../constants/calling/call.constants.js";
import { objectIdSchema } from "./common.validation.js";

// --- Zod Schemas ---

export const groupIdParamSchema = z.object({
  id: objectIdSchema,
});

export const callIdParamSchema = z.object({
  id: objectIdSchema,
});

export const callHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive("Page must be a positive integer.").optional(),
  limit: z.coerce.number().int().positive("Limit must be a positive integer.").optional(),
}).passthrough();

// --- Standard Middleware Handlers ---

/**
 * Validates group ID in request parameters.
 */
export const validateGroupIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.id)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      CALL_ERROR_MESSAGES.INVALID_GROUP_ID,
    );
  }
  next();
};

/**
 * Validates pagination query parameters for call history endpoints.
 */
export const validateCallHistoryQuery = (req, _res, next) => {
  const { limit, page } = req.query;

  if (limit !== undefined) {
    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Limit must be a positive integer.",
      );
    }
  }

  if (page !== undefined) {
    const parsedPage = Number(page);
    if (!Number.isInteger(parsedPage) || parsedPage <= 0) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Page must be a positive integer.",
      );
    }
  }

  next();
};
