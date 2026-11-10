import { Router } from "express";
import callController from "../controllers/call.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";
import { validateCallHistoryQuery } from "../validations/call.validation.js";

const router = Router();

router.get(
  "/history",
  authMiddleware,
  validateCallHistoryQuery,
  callController.getCallHistory,
);

export default router;
