import { Router } from "express";
import callController from "../controllers/call.controller.js";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import { validateCallHistoryQuery } from "../validations/call.validation.js";

const router = Router();

router.get(
  "/history",
  authMiddleware,
  validateCallHistoryQuery,
  callController.getCallHistory,
);

router.patch(
  "/mark-seen",
  authMiddleware,
  callController.markMissedCallsSeen,
);

router.patch(
  "/missed/seen",
  authMiddleware,
  callController.markMissedCallsSeen,
);

export default router;
