import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import {
  GROUP_ROLES,
  GROUP_ERROR_MESSAGES,
} from "../constants/index.js";

export const assertAdmin = (member) => {
  if (member?.role !== GROUP_ROLES.ADMIN) {
    throw new ApiError(StatusCodes.FORBIDDEN, GROUP_ERROR_MESSAGES.ADMIN_ONLY);
  }
};

export const canRemoveMember = ({ group, actorId, targetId, member }) => {
  const actor = String(actorId);
  const target = String(targetId);
  const owner = String(group.owner);

  if (member?.role !== GROUP_ROLES.ADMIN && owner !== actor) {
    throw new ApiError(StatusCodes.FORBIDDEN, GROUP_ERROR_MESSAGES.ADMIN_ONLY);
  }
  if (actor === target) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.CANNOT_REMOVE_SELF,
    );
  }
  if (owner === target) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.CANNOT_REMOVE_OWNER,
    );
  }

  const targetMember = group.members.find(
    (m) => String(m.userId?._id || m.userId) === target,
  );
  if (!targetMember) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.USER_NOT_IN_GROUP,
    );
  }

  if (targetMember.role === GROUP_ROLES.ADMIN && owner !== actor) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.ONLY_OWNER_REMOVE_ADMIN,
    );
  }
};

export const canChangeMemberRole = ({
  group,
  actorId,
  targetId,
  newRole,
  member,
}) => {
  const actor = String(actorId);
  const target = String(targetId);
  const owner = String(group.owner);

  if (member?.role !== GROUP_ROLES.ADMIN && owner !== actor) {
    throw new ApiError(StatusCodes.FORBIDDEN, GROUP_ERROR_MESSAGES.ADMIN_ONLY);
  }
  if (actor === target) {
    throw new ApiError(
      StatusCodes.BAD_REQUEST,
      GROUP_ERROR_MESSAGES.CANNOT_CHANGE_OWN_ROLE,
    );
  }
  if (owner === target) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.CANNOT_CHANGE_OWNER_ROLE,
    );
  }

  const targetMember = group.members.find(
    (m) => String(m.userId?._id || m.userId) === target,
  );
  if (!targetMember) {
    throw new ApiError(
      StatusCodes.NOT_FOUND,
      GROUP_ERROR_MESSAGES.USER_NOT_IN_GROUP,
    );
  }

  if (
    newRole === GROUP_ROLES.MEMBER &&
    targetMember.role === GROUP_ROLES.ADMIN
  ) {
    if (owner !== actor) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        GROUP_ERROR_MESSAGES.ONLY_OWNER_DEMOTE_ADMIN,
      );
    }
    const adminCount = group.members.filter(
      (m) => m.role === GROUP_ROLES.ADMIN,
    ).length;
    if (adminCount <= 1) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        GROUP_ERROR_MESSAGES.CANNOT_DEMOTE_LAST_ADMIN,
      );
    }
  }
};

export const canDeleteMessage = ({ group, member, message, actorId }) => {
  const actor = String(actorId);
  const isSender = String(message.senderId) === actor;
  const isAdminOrOwner =
    member?.role === GROUP_ROLES.ADMIN || String(group.owner) === actor;

  if (!isSender && !isAdminOrOwner) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.DELETE_FORBIDDEN,
    );
  }
};

export const canEditMessage = ({ message, actorId }) => {
  if (String(message.senderId) !== String(actorId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.EDIT_FORBIDDEN,
    );
  }
};

export const canManageShare = ({ share, group, actorId, member, action }) => {
  const actor = String(actorId);
  const isSharer = String(share.sharerId) === actor;

  if (action === "update") {
    if (!isSharer) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        GROUP_ERROR_MESSAGES.SHARE_MANAGE_FORBIDDEN,
      );
    }
    return;
  }

  const isAdminOrOwner =
    member?.role === GROUP_ROLES.ADMIN || String(group.owner) === actor;
  if (!isSharer && !isAdminOrOwner) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.SHARE_MANAGE_FORBIDDEN,
    );
  }
};

export const canSetGroupKeys = ({
  group,
  actorId,
  member,
  isNewVersion,
  hasCurrentKey,
}) => {
  const isAdminOrOwner =
    member?.role === GROUP_ROLES.ADMIN ||
    String(group.owner) === String(actorId);

  if (isNewVersion) {
    if (!isAdminOrOwner) {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        GROUP_ERROR_MESSAGES.ADMIN_ONLY,
      );
    }
    return;
  }

  if (!isAdminOrOwner && !hasCurrentKey) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      GROUP_ERROR_MESSAGES.KEY_PUBLISH_FORBIDDEN,
    );
  }
};
