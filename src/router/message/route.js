import express from "express";
import messageController from "../../controllers/messages.controller.js";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import upload, {
  enforceTypeSizeLimit,
} from "../../middlewares/multer.middleware.js";

const router = express.Router();

router.use(authMiddleware);

router.route("/").get(messageController.getUsersForSidebar);

router.route("/:id").get(messageController.getMessage);

router
  .route("/send/:id")
  .post(
    upload.single("image"),
    enforceTypeSizeLimit,
    messageController.sendMessage,
  );

router.patch("/seen/:id", messageController.markMessagesSeen);

router.patch("/react/:messageId", messageController.reactMessage);

router.delete(
  "/delete-for-me/:messageId",
  messageController.deleteMessageForMe,
);

router.delete(
  "/delete-for-everyone/:messageId",
  messageController.deleteMessageForEveryone,
);

export default router;
