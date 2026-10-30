import { StatusCodes } from "http-status-codes";
import ApiError from "./api-error.js";

export const validName = (name) => {
  if (!name || name.length < 2 || name.length > 50) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      "Group name must be 2-50 characters.",
    );
  }
};
