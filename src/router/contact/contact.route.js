import { Router } from "express";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import {
  searchUsers,
  addContact,
  removeContact,
  getContacts,
  getChatList,
} from "../../controllers/contact.controller.js";

const router = Router();
router.use(authMiddleware);

router.get("/search", searchUsers);
router.get("/", getContacts);
router.get("/chats", getChatList);
router.post("/:userId", addContact);
router.delete("/:userId", removeContact);

export default router;
