import { Router } from "express";
import aiController from "../../controllers/ai.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import {
  publicChatLimiter,
  toolsLimiter,
} from "../../middlewares/rateLimit/ai-rate-limit.middleware.js";

const router = Router();

router.post("/chatbot", publicChatLimiter, aiController.chatbot);

router.use(authMiddleware, toolsLimiter);

router.post("/correct", aiController.correctEnglish);
router.post("/rewrite", aiController.rewriteText);
router.post("/hinglish", aiController.hinglishToEnglish);

export default router;
