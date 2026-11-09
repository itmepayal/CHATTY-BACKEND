import { Router } from "express";
import authMiddleware from "../../middlewares/authMidleware.middleware.js";
import contactController from "../../controllers/contact.controller.js";

const router = Router();
router.use(authMiddleware);

// Static / specialized routes must precede parameterized :userId routes
router.get("/search", contactController.searchUsers);
router.get("/chats", contactController.getChatList);
router.get("/count", contactController.getContactCount);
router.get("/mutual/:otherUserId", contactController.getMutualContacts);
router.post("/bulk", contactController.bulkAddContacts);

// Base collection route
router.get("/", contactController.getContacts);

// Parameterized member routes
router.get("/:userId", contactController.getContactById);
router.post("/:userId", contactController.addContact);
router.patch("/:userId", contactController.updateContactNickname);
router.patch("/:userId/nickname", contactController.updateContactNickname);
router.put("/:userId", contactController.updateContactNickname);
router.delete("/:userId", contactController.removeContact);

export default router;
