import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";

/**
 * Centralized Zod request validation middleware factory.
 * Uses safeParse and stores results on req.validated.
 * Syncs parsed body fields back onto req.body for existing controllers.
 * Does not assign onto req.query.
 *
 * @param {import("zod").ZodSchema} schema
 * @param {"body"|"query"|"params"} [target="body"]
 * @returns {import("express").RequestHandler}
 */
export const validate =
  (schema, target = "body") =>
  (req, _res, next) => {
    const result = schema.safeParse(req[target] || {});
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue?.message || "Validation error.";
      return next(new ApiError(StatusCodes.BAD_REQUEST, message));
    }

    if (!req.validated) {
      req.validated = {};
    }
    req.validated[target] = result.data;

    if (target === "body" && typeof req.body === "object" && req.body !== null) {
      Object.assign(req.body, result.data);
    }

    next();
  };
