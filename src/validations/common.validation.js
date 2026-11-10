import { z } from "zod";
export { validate } from "../middlewares/validation/validate.middleware.js";

export const objectIdRegex = /^[0-9a-fA-F]{24}$/;

/**
 * Zod schema validating a 24-character hexadecimal MongoDB ObjectId string.
 */
export const objectIdSchema = z
  .string({ required_error: "ID is required." })
  .trim()
  .regex(objectIdRegex, "Invalid ID format.");

/**
 * Reusable schema for standard pagination query parameters.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .int("Page must be an integer.")
    .positive("Page must be a positive integer.")
    .default(1),
  limit: z.coerce
    .number()
    .int("Limit must be an integer.")
    .min(1, "Limit must be at least 1.")
    .max(100, "Limit cannot exceed 100.")
    .default(50),
});

/**
 * Standard ID parameter validation schema (:id)
 */
export const idParamSchema = z.object({
  id: objectIdSchema,
});

