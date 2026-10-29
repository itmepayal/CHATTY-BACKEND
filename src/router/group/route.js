import { Router } from "express";
import groupController from "../../controllers/group.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import upload from "../../middlewares/multer.middleware.js";

const router = Router();

router.use(authMiddleware);

// Get all groups for the logged-in user
router
  .route("/")
  .get(groupController.getMyGroups)
  .post(upload.single("avatar"), groupController.createGroup);

// Get, update, and delete a group
router
  .route("/:id")
  .get(groupController.getGroup)
  .patch(upload.single("avatar"), groupController.updateGroup)
  .delete(groupController.deleteGroup);

// Archive and unarchive a group
router.put("/:id/archive", groupController.archiveGroup);
router.delete("/:id/archive", groupController.unarchiveGroup);

// Add and remove group members
router.post("/:id/members", groupController.addMembers);
router.delete("/:id/members/:userId", groupController.removeMember);

// Change a member's role
router.patch("/:id/members/:userId/role", groupController.changeRole);

// Leave a group
router.post("/:id/leave", groupController.leaveGroup);

// Get and send group messages
router
  .route("/:id/messages")
  .get(groupController.getGroupMessages)
  .post(upload.single("image"), groupController.sendGroupMessage);

// Mark group messages as seen
router.post("/:id/seen", groupController.markGroupSeen);

// ==========================================
// Group Live Location Sharing
// ==========================================

// Send current location pin / start live location in a group
router.post("/:id/location", groupController.startGroupShare);

// Get active location shares for a group
// (":shareId" wale routes se pehle rakha hai, taaki "active" shareId na samjha jaye)
router.get("/:id/location/active", groupController.getActiveGroupShares);

// Push a new position for an existing live share
router.patch("/:id/location/:shareId", groupController.updateGroupShare);

// Stop sharing a group location
router.post("/:id/location/:shareId/stop", groupController.stopGroupShare);

export default router;
