import { z } from "zod";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import { isValidObjectId } from "../../../shared/utils/object-id.util.js";
import { CALL_ERROR_MESSAGES } from "../constants/call.constants.js";
import { objectIdSchema } from "../../../shared/validators/object-id.validation.js";

// --- Zod Schemas ---

export const groupIdParamSchema = z.object({
  id: objectIdSchema,
});

export const callIdParamSchema = z.object({
  id: objectIdSchema,
});

export const callHistoryQuerySchema = z
  .object({
    page: z.coerce
      .number()
      .int()
      .positive("Page must be a positive integer.")
      .optional(),
    limit: z.coerce
      .number()
      .int()
      .positive("Limit must be a positive integer.")
      .optional(),
  })
  .passthrough();

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

/**
 * Validates Call ID parameter in routes.
 */
export const validateCallIdParam = (req, _res, next) => {
  const { callId } = req.params;
  if (!callId || typeof callId !== "string" || callId.length > 128 || !/^[\w-]+$/.test(callId)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid call ID parameter.");
  }
  next();
};

/**
 * Validates array of call IDs for bulk history deletion.
 */
export const validateBulkDeleteCallIds = (req, _res, next) => {
  const { callIds } = req.body || {};
  if (!Array.isArray(callIds) || callIds.length === 0) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "An array of call IDs is required for bulk deletion.",
    );
  }
  if (callIds.length > 100) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Cannot delete more than 100 call records in a single request.",
    );
  }
  for (const id of callIds) {
    if (!id || typeof id !== "string" || id.length > 128 || !/^[\w-]+$/.test(id)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Invalid call ID format in request: ${id}`,
      );
    }
  }
  next();
};
