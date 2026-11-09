import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import { isValidObjectId } from "../utils/object-id.util.js";
import {
  GROUP_NAME_MIN,
  GROUP_NAME_MAX,
  GROUP_ROLES,
  GROUP_ERROR_MESSAGES,
  MAX_PAGE_LIMIT,
} from "../constants/group.constants.js";

/**
 * Validates request parameter :id as a valid MongoDB ObjectId.
 */
export const validateGroupIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.id)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_GROUP_ID,
    );
  }
  next();
};

/**
 * Validates request parameter :userId as a valid MongoDB ObjectId.
 */
export const validateUserIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.userId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }
  next();
};

/**
 * Validates request parameter :messageId as a valid MongoDB ObjectId.
 */
export const validateMessageIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.messageId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_MESSAGE_ID,
    );
  }
  next();
};

/**
 * Validates request parameter :shareId as a valid MongoDB ObjectId.
 */
export const validateShareIdParam = (req, _res, next) => {
  if (!isValidObjectId(req.params.shareId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_SHARE_ID,
    );
  }
  next();
};

/**
 * Validates composite parameters :id and :userId.
 */
export const validateMemberParams = (req, _res, next) => {
  if (!isValidObjectId(req.params.id)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_GROUP_ID,
    );
  }
  if (!isValidObjectId(req.params.userId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_USER_ID,
    );
  }
  next();
};

/**
 * Validates composite parameters :id and :messageId.
 */
export const validateMessageParams = (req, _res, next) => {
  if (!isValidObjectId(req.params.id)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_GROUP_ID,
    );
  }
  if (!isValidObjectId(req.params.messageId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_MESSAGE_ID,
    );
  }
  next();
};

/**
 * Validates composite parameters :id and :shareId.
 */
export const validateShareParams = (req, _res, next) => {
  if (!isValidObjectId(req.params.id)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_GROUP_ID,
    );
  }
  if (!isValidObjectId(req.params.shareId)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_SHARE_ID,
    );
  }
  next();
};

/**
 * Validates body payload when creating a new group.
 */
export const validateCreateGroupBody = (req, _res, next) => {
  const { name } = req.body || {};
  if (typeof name !== "string") {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_NAME,
    );
  }
  const trimmed = name.trim();
  if (trimmed.length < GROUP_NAME_MIN || trimmed.length > GROUP_NAME_MAX) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_NAME,
    );
  }
  req.body.name = trimmed;
  next();
};

/**
 * Validates body payload when updating a group's metadata.
 */
export const validateUpdateGroupBody = (req, _res, next) => {
  const { name } = req.body || {};
  if (name !== undefined) {
    if (typeof name !== "string") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.INVALID_NAME,
      );
    }
    const trimmed = name.trim();
    if (trimmed.length < GROUP_NAME_MIN || trimmed.length > GROUP_NAME_MAX) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.INVALID_NAME,
      );
    }
    req.body.name = trimmed;
  }
  next();
};

/**
 * Validates body payload for adding members to an existing group.
 */
export const validateAddMembersBody = (req, _res, next) => {
  const { memberIds } = req.body || {};
  if (!memberIds) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.NO_NEW_MEMBERS,
    );
  }
  next();
};

/**
 * Validates role changes for group members.
 */
export const validateChangeRoleBody = (req, _res, next) => {
  const { role } = req.body || {};
  if (!role || (role !== GROUP_ROLES.ADMIN && role !== GROUP_ROLES.MEMBER)) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_ROLE,
    );
  }
  next();
};

/**
 * Validates query pagination parameters for group messages.
 */
export const validatePaginationQuery = (req, _res, next) => {
  const { limit } = req.query;
  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.INVALID_PAGINATION,
      );
    }
  }
  next();
};
