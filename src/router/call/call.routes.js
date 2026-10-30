import { Router } from "express";
import callController from "../../controllers/call.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";

const router = Router();

router.get("/history", authMiddleware, callController.getCallHistory);

export default router;
