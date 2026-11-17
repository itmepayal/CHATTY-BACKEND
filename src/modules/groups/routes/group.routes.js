import { Router } from "express";
import groupController from "../controllers/group.controller.js";
import * as groupInviteController from "../controllers/group-invite.controller.js";
import messageController from "../../messaging/controllers/messages.controller.js";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import upload, {
  enforceTypeSizeLimit,
  autoCleanupMulterOnFailure,
} from "../../../middlewares/multer.middleware.js";
import {
  sendMessageLimiter,
  settingsLimiter,
} from "../../../middlewares/rateLimit/index.js";
import {
  validateGroupIdParam,
  validateMemberParams,
  validateMessageParams,
  validateShareParams,
  validateCreateGroupBody,
  validateUpdateGroupBody,
  validateAddMembersBody,
  validateChangeRoleBody,
  validatePaginationQuery,
  validateSetGroupKeysBody,
} from "../validations/group.validation.js";

const router = Router();

router.use(authMiddleware);

// Group invitations routes
router.get("/invites/my", groupInviteController.getMyGroupInvites);
router.post("/invites/:inviteId/accept", groupInviteController.acceptGroupInvite);
router.post("/invites/:inviteId/decline", groupInviteController.declineGroupInvite);
router.post("/:id/invites", validateGroupIdParam, groupInviteController.createGroupInvite);

// Group collection routes
router
  .route("/")
  .get(groupController.getMyGroups)
  .post(
    settingsLimiter,
    upload.single("avatar"),
    autoCleanupMulterOnFailure,
    enforceTypeSizeLimit,
    validateCreateGroupBody,
    groupController.createGroup,
  );

// E2EE Key management routes
router.get("/:id/keys", validateGroupIdParam, groupController.getMyGroupKeys);
router.get(
  "/:id/keys/pending",
  validateGroupIdParam,
  groupController.getPendingKeyMembers,
);
router.post(
  "/:id/keys",
  settingsLimiter,
  validateGroupIdParam,
  validateSetGroupKeysBody,
  groupController.setGroupKeys,
);

// Group messaging routes
router
  .route("/:id/messages")
  .get(
    validateGroupIdParam,
    validatePaginationQuery,
    groupController.getGroupMessages,
  )
  .post(
    sendMessageLimiter,
    validateGroupIdParam,
    upload.single("image"),
    autoCleanupMulterOnFailure,
    enforceTypeSizeLimit,
    groupController.sendGroupMessage,
  );

router.delete(
  "/:id/messages/:messageId",
  validateMessageParams,
  groupController.deleteGroupMessage,
);

router.patch(
  "/:id/messages/:messageId",
  sendMessageLimiter,
  validateMessageParams,
  groupController.editGroupMessage,
);

// Read receipts route
router.post("/:id/seen", validateGroupIdParam, groupController.markGroupSeen);

// Scheduled group messages
router.post(
  "/:id/schedule",
  sendMessageLimiter,
  validateGroupIdParam,
  (req, res, next) => {
    req.body.groupId = req.params.id;
    req.body.messageType = "group";
    return messageController.scheduleMessage(req, res, next);
  },
);

// Location sharing routes
router.post(
  "/:id/location",
  settingsLimiter,
  validateGroupIdParam,
  groupController.startGroupShare,
);
router.get(
  "/:id/location/active",
  validateGroupIdParam,
  groupController.getActiveGroupShares,
);
router.patch(
  "/:id/location/:shareId",
  validateShareParams,
  groupController.updateGroupShare,
);
router.post(
  "/:id/location/:shareId/stop",
  settingsLimiter,
  validateShareParams,
  groupController.stopGroupShare,
);

// Archive / Unarchive routes
router.put("/:id/archive", validateGroupIdParam, groupController.archiveGroup);
router.delete(
  "/:id/archive",
  validateGroupIdParam,
  groupController.unarchiveGroup,
);

// Membership management routes
router.post(
  "/:id/members",
  settingsLimiter,
  validateGroupIdParam,
  validateAddMembersBody,
  groupController.addMembers,
);
router.delete(
  "/:id/members/:userId",
  settingsLimiter,
  validateMemberParams,
  groupController.removeMember,
);
router.patch(
  "/:id/members/:userId/role",
  settingsLimiter,
  validateMemberParams,
  validateChangeRoleBody,
  groupController.changeRole,
);
router.post("/:id/leave", validateGroupIdParam, groupController.leaveGroup);

// Individual group resource routes
router
  .route("/:id")
  .get(validateGroupIdParam, groupController.getGroup)
  .patch(
    settingsLimiter,
    validateGroupIdParam,
    upload.single("avatar"),
    autoCleanupMulterOnFailure,
    enforceTypeSizeLimit,
    validateUpdateGroupBody,
    groupController.updateGroup,
  )
  .delete(settingsLimiter, validateGroupIdParam, groupController.deleteGroup);

export default router;
