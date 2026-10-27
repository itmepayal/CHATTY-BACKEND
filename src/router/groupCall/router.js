import { Router } from "express";
import groupCallController from "../../controllers/groupcall.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";

const router = Router();

router.get("/history", authMiddleware, groupCallController.getMyGroupCalls);
router.get(
  "/group/:id",
  authMiddleware,
  groupCallController.getGroupCallHistory,
);

export default router;
