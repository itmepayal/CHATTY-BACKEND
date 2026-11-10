import { Router } from "express";
import aiController from "../controllers/ai.controller.js";
import authMiddleware from "../middlewares/auth.middleware.js";
import {
  publicChatLimiter,
  toolsLimiter,
} from "../middlewares/rateLimit/index.js";
import {
  validateCorrectBody,
  validateRewriteBody,
  validateHinglishBody,
  validateChatbotBody,
} from "../validations/ai.validation.js";

const router = Router();

router.post(
  "/chatbot",
  publicChatLimiter,
  validateChatbotBody,
  aiController.chatbot,
);

router.use(authMiddleware, toolsLimiter);

router.post("/correct", validateCorrectBody, aiController.correctEnglish);
router.post("/rewrite", validateRewriteBody, aiController.rewriteText);
router.post("/hinglish", validateHinglishBody, aiController.hinglishToEnglish);

export default router;
