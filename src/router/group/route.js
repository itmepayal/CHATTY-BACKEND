import { Router } from "express";
import groupController from "../../controllers/group.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import upload, {
  enforceTypeSizeLimit,
} from "../../middlewares/multer.middleware.js";
import {
  sendMessageLimiter,
  settingsLimiter,
} from "../../middlewares/rateLimit.middleware.js";

const router = Router();

router.use(authMiddleware);

/* ==========================================
   GROUPS: list + create
========================================== */
router
  .route("/")
  .get(groupController.getMyGroups)
  .post(settingsLimiter, upload.single("avatar"), groupController.createGroup);

/* ==========================================
   E2EE GROUP KEYS
========================================== */
router.get("/:id/keys", groupController.getMyGroupKeys);
router.get("/:id/keys/pending", groupController.getPendingKeyMembers);
router.post("/:id/keys", settingsLimiter, groupController.setGroupKeys);

/* ==========================================
   GROUP MESSAGES
========================================== */
router
  .route("/:id/messages")
  .get(groupController.getGroupMessages)
  .post(
    sendMessageLimiter,
    upload.single("image"),
    enforceTypeSizeLimit,
    groupController.sendGroupMessage,
  );

router.post("/:id/seen", groupController.markGroupSeen);

/* ==========================================
   GROUP LIVE LOCATION
========================================== */
router.post("/:id/location", settingsLimiter, groupController.startGroupShare);
router.get("/:id/location/active", groupController.getActiveGroupShares);
// No limiter: controller already throttles updates (2s per share)
router.patch("/:id/location/:shareId", groupController.updateGroupShare);
router.post(
  "/:id/location/:shareId/stop",
  settingsLimiter,
  groupController.stopGroupShare,
);

/* ==========================================
   ARCHIVE / UNARCHIVE
========================================== */
router.put("/:id/archive", groupController.archiveGroup);
router.delete("/:id/archive", groupController.unarchiveGroup);

/* ==========================================
   MEMBERS
========================================== */
router.post("/:id/members", settingsLimiter, groupController.addMembers);
router.delete(
  "/:id/members/:userId",
  settingsLimiter,
  groupController.removeMember,
);
router.patch(
  "/:id/members/:userId/role",
  settingsLimiter,
  groupController.changeRole,
);

router.post("/:id/leave", groupController.leaveGroup);

/* ==========================================
   SINGLE GROUP: get / update / delete
========================================== */
router
  .route("/:id")
  .get(groupController.getGroup)
  .patch(settingsLimiter, upload.single("avatar"), groupController.updateGroup)
  .delete(settingsLimiter, groupController.deleteGroup);

export default router;
