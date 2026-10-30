import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";

export const notFoundHandler = (req, _res, next) => {
  next(
    new ApiError(StatusCodes.NOT_FOUND, `Route not found: ${req.originalUrl}`),
  );
};

export const errorHandler = (err, _req, res, _next) => {
  let statusCode = err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  let message = err.message || "Internal Server Error";

  if (err.name === "CastError") {
    statusCode = StatusCodes.BAD_REQUEST;
    message = `Invalid ${err.path}.`;
  }

  if (err.name === "ValidationError") {
    statusCode = StatusCodes.BAD_REQUEST;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(", ");
  }

  if (err.code === 11000) {
    statusCode = StatusCodes.CONFLICT;
    const field = Object.keys(err.keyPattern || {})[0] || "field";
    message = `Duplicate value for ${field}.`;
  }

  if (!err.isOperational) {
    console.error(err);
  }

  if (statusCode >= 500 && !err.isOperational) {
    message = "Internal Server Error";
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
  });
};
