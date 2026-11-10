import { Router } from "express";
import groupCallController from "../controllers/groupcall.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";
import {
  validateCallHistoryQuery,
  validateGroupIdParam,
} from "../validations/call.validation.js";

const router = Router();

router.get(
  "/history",
  authMiddleware,
  validateCallHistoryQuery,
  groupCallController.getMyGroupCalls,
);

router.get(
  "/group/:id",
  authMiddleware,
  validateGroupIdParam,
  validateCallHistoryQuery,
  groupCallController.getGroupCallHistory,
);

export default router;
