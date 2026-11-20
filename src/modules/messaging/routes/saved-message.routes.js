import { Router } from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import * as savedMessageController from "../controllers/saved-message.controller.js";

const router = Router();

router.use(authMiddleware);

router
  .route("/")
  .get(savedMessageController.getSavedMessages)
  .post(savedMessageController.saveMessage);

router.post("/notes", savedMessageController.createNote);
router.get("/meta", savedMessageController.getSavedMeta);

router
  .route("/:id")
  .patch(savedMessageController.updateSavedMessage)
  .delete(savedMessageController.unsaveMessage);

export default router;
