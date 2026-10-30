import { Router } from "express";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import contactController from "../../controllers/contact.controller.js";

const router = Router();
router.use(authMiddleware);

router.get("/search", contactController.searchUsers);
router.get("/", contactController.getContacts);
router.get("/chats", contactController.getChatList);
router.post("/:userId", contactController.addContact);
router.delete("/:userId", contactController.removeContact);

export default router;
