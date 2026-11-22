import { Router } from "express";
import callController from "../controllers/call.controller.js";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import {
  validateCallHistoryQuery,
  validateCallIdParam,
  validateBulkDeleteCallIds,
} from "../validations/call.validation.js";
import {
  callHistoryLimiter,
  callIceServersLimiter,
  callDeleteLimiter,
} from "../../../middlewares/rateLimit/call-rate-limit.middleware.js";

const router = Router();

router.get(
  "/history",
  authMiddleware,
  callHistoryLimiter,
  validateCallHistoryQuery,
  callController.getCallHistory,
);

router.post(
  "/history/bulk-delete",
  authMiddleware,
  callDeleteLimiter,
  validateBulkDeleteCallIds,
  callController.bulkDeleteCallHistory,
);

router.delete(
  "/history/bulk",
  authMiddleware,
  callDeleteLimiter,
  validateBulkDeleteCallIds,
  callController.bulkDeleteCallHistory,
);

router.delete(
  "/history/clear",
  authMiddleware,
  callDeleteLimiter,
  callController.clearCallHistory,
);

router.delete(
  "/history",
  authMiddleware,
  callDeleteLimiter,
  callController.clearCallHistory,
);

router.delete(
  "/history/:callId",
  authMiddleware,
  callDeleteLimiter,
  validateCallIdParam,
  callController.deleteCallHistoryItem,
);

router.delete(
  "/:callId",
  authMiddleware,
  callDeleteLimiter,
  validateCallIdParam,
  callController.deleteCallHistoryItem,
);

router.get(
  "/ice-servers",
  authMiddleware,
  callIceServersLimiter,
  callController.getIceServers,
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

router.post(
  "/translate",
  authMiddleware,
  callController.translateCaption,
);

export default router;
