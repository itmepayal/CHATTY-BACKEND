import { StatusCodes } from "http-status-codes";
import ApiError from "../../shared/errors/api-error.js";

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

    if (
      target === "body" &&
      typeof req.body === "object" &&
      req.body !== null
    ) {
      Object.assign(req.body, result.data);
    }

    next();
  };
