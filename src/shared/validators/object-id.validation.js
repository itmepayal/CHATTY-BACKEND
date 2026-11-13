import { z } from "zod";
import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../errors/api-error.js";

export const objectIdRegex = /^[0-9a-fA-F]{24}$/;

export const objectIdSchema = z
  .string({ required_error: "ID is required." })
  .trim()
  .regex(objectIdRegex, "Invalid ID format.");

export const idParamSchema = z.object({
  id: objectIdSchema,
});

export const assertValidId = (id, label = "ID") => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(StatusCodes.BAD_REQUEST, `Invalid ${label}.`);
  }
};
