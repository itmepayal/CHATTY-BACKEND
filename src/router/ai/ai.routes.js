import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import aiController from "../../controllers/ai.controller.js";
import verifyJWT from "../../middlewares/authMidleware.middleware.js";

const router = Router();

const LIMIT_MESSAGE = {
  success: false,
  message: "Too many AI requests. Please wait a minute.",
};

const publicChatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: LIMIT_MESSAGE,
});

const toolsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = req.user?._id ?? req.user?.id;
    return userId ? String(userId) : ipKeyGenerator(req.ip);
  },
  message: LIMIT_MESSAGE,
});

router.post("/chatbot", publicChatLimiter, aiController.chatbot);

router.use(verifyJWT, toolsLimiter);

router.post("/correct", aiController.correctEnglish);
router.post("/rewrite", aiController.rewriteText);
router.post("/hinglish", aiController.hinglishToEnglish);

export default router;
