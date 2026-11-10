import { z } from "zod";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import { isValidObjectId } from "../../../shared/utils/object-id.util.js";
import {
  GROUP_NAME_MIN,
  GROUP_NAME_MAX,
  GROUP_ROLES,
  GROUP_ERROR_MESSAGES,
} from "../constants/index.js";
import { objectIdSchema } from "../../../shared/validators/object-id.validation.js";

// --- Zod Schemas ---

export const groupIdParamSchema = z.object({
  id: objectIdSchema,
});

export const userIdParamSchema = z.object({
  userId: objectIdSchema,
});

export const messageIdParamSchema = z.object({
  messageId: objectIdSchema,
});

export const shareIdParamSchema = z.object({
  shareId: objectIdSchema,
});

export const memberParamsSchema = z.object({
  id: objectIdSchema,
  userId: objectIdSchema,
});

export const messageParamsSchema = z.object({
  id: objectIdSchema,
  messageId: objectIdSchema,
});

export const shareParamsSchema = z.object({
  id: objectIdSchema,
  shareId: objectIdSchema,
});

export const createGroupBodySchema = z
  .object({
    name: z
      .string({ required_error: GROUP_ERROR_MESSAGES.INVALID_NAME })
      .trim()
      .min(GROUP_NAME_MIN, GROUP_ERROR_MESSAGES.INVALID_NAME)
      .max(GROUP_NAME_MAX, GROUP_ERROR_MESSAGES.INVALID_NAME),
    description: z.string().max(500).optional(),
    members: z.union([z.string(), z.array(objectIdSchema)]).optional(),
  })
  .passthrough();

export const updateGroupBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(GROUP_NAME_MIN, GROUP_ERROR_MESSAGES.INVALID_NAME)
      .max(GROUP_NAME_MAX, GROUP_ERROR_MESSAGES.INVALID_NAME)
      .optional(),
    description: z.string().max(500).optional(),
  })
  .passthrough();

export const addMembersBodySchema = z
  .object({
    memberIds: z.union([z.string(), z.array(z.string())], {
      required_error: GROUP_ERROR_MESSAGES.NO_NEW_MEMBERS,
    }),
  })
  .passthrough();

export const changeRoleBodySchema = z
  .object({
    role: z.enum([GROUP_ROLES.ADMIN, GROUP_ROLES.MEMBER], {
      errorMap: () => ({ message: GROUP_ERROR_MESSAGES.INVALID_ROLE }),
    }),
  })
  .passthrough();

export const groupPaginationQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1, GROUP_ERROR_MESSAGES.INVALID_PAGINATION)
      .optional(),
    before: z.string().datetime().optional(),
    after: z.string().datetime().optional(),
  })
  .passthrough();

// --- Standard Middleware Handlers ---

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
  const { limit, before, after } = req.query;
  if (limit !== undefined) {
    const l = Number(limit);
    if (!Number.isInteger(l) || l < 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.INVALID_PAGINATION,
      );
    }
  }
  if (before !== undefined && Number.isNaN(new Date(before).getTime())) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_PAGINATION,
    );
  }
  if (after !== undefined && Number.isNaN(new Date(after).getTime())) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.INVALID_PAGINATION,
    );
  }
  next();
};
