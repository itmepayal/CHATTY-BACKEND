import { Router } from "express";
import groupController from "../../controllers/group.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import upload from "../../middlewares/multer.middleware.js";

const router = Router();

router.use(authMiddleware);

router
  .route("/")
  .get(groupController.getMyGroups)
  .post(upload.single("avatar"), groupController.createGroup);

router
  .route("/:id")
  .get(groupController.getGroup)
  .patch(upload.single("avatar"), groupController.updateGroup)
  .delete(groupController.deleteGroup);

router.post("/:id/members", groupController.addMembers);
router.delete("/:id/members/:userId", groupController.removeMember);
router.patch("/:id/members/:userId/role", groupController.changeRole);
router.post("/:id/leave", groupController.leaveGroup);

router
  .route("/:id/messages")
  .get(groupController.getGroupMessages)
  .post(upload.single("image"), groupController.sendGroupMessage);

router.post("/:id/seen", groupController.markGroupSeen);

export default router;
