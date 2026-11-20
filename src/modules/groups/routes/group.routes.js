import { Router } from "express";
import groupController from "../controllers/group.controller.js";
import * as groupInviteController from "../controllers/group-invite.controller.js";
import messageController from "../../messaging/controllers/messages.controller.js";
import * as advancedController from "../../messaging/controllers/advanced-messaging.controller.js";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import requireChatUnlocked from "../../../middlewares/chat-lock.middleware.js";
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
    requireChatUnlocked("id"),
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

router.get(
  "/:id/messages/pinned",
  validateGroupIdParam,
  groupController.getPinnedGroupMessages,
);

router.delete(
  "/:id/messages/:messageId/me",
  validateMessageParams,
  groupController.deleteGroupMessageForMe,
);

router.delete(
  "/:id/messages/:messageId",
  validateMessageParams,
  groupController.deleteGroupMessage,
);

router.patch(
  "/:id/messages/:messageId/pin",
  validateMessageParams,
  groupController.togglePinGroupMessage,
);

router.patch(
  "/:id/messages/:messageId/star",
  validateMessageParams,
  groupController.toggleStarGroupMessage,
);

router.patch(
  "/:id/messages/:messageId",
  sendMessageLimiter,
  validateMessageParams,
  groupController.editGroupMessage,
);

// Advanced Messaging: Group Reactions
router.post(
  "/:id/messages/:messageId/reactions",
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.toggleReaction(req, res, next);
  },
);
router.get(
  "/:id/messages/:messageId/reactions",
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.getReactionDetails(req, res, next);
  },
);

// Advanced Messaging: Group Threads
router.get(
  "/:id/messages/:messageId/thread",
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.getThread(req, res, next);
  },
);
router.post(
  "/:id/messages/:messageId/thread",
  sendMessageLimiter,
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.sendThreadReply(req, res, next);
  },
);

// Advanced Messaging: Group Polls
router.post(
  "/:id/polls",
  sendMessageLimiter,
  validateGroupIdParam,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.createPoll(req, res, next);
  },
);
router.post(
  "/:id/messages/:messageId/poll/vote",
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.castVote(req, res, next);
  },
);
router.post(
  "/:id/messages/:messageId/poll/close",
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.closePoll(req, res, next);
  },
);
router.get(
  "/:id/messages/:messageId/poll",
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.getPollDetails(req, res, next);
  },
);

// Advanced Messaging: Group Disappearing Messages
router.patch(
  "/:id/disappearing",
  settingsLimiter,
  validateGroupIdParam,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.setGroupDisappearing(req, res, next);
  },
);

// Advanced Messaging: Group View-Once
router.post(
  "/:id/messages/:messageId/view-once/open",
  validateMessageParams,
  (req, res, next) => {
    req.params.groupId = req.params.id;
    return advancedController.markViewOnceOpened(req, res, next);
  },
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
