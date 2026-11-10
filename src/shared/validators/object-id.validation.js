import { z } from "zod";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../errors/api-error.js";

export const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Zod schema validating a 24-character hexadecimal MongoDB ObjectId string.
 */
export const objectIdSchema = z
  .string({ required_error: "ID is required." })
  .trim()
  .regex(objectIdRegex, "Invalid ID format.");

/**
 * Standard ID parameter validation schema (:id)
 */
export const idParamSchema = z.object({
  id: objectIdSchema,
});

/**
 * Validates a value is a valid MongoDB ObjectId or throws a 400 ApiError.
 *
 * @param {string|mongoose.Types.ObjectId} id
 * @param {string} [label="ID"]
 */
export const assertValidId = (id, label = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${label}.`);
  }
};
