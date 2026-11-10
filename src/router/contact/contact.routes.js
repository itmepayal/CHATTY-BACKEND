import { Router } from "express";
import authMiddleware from "../../middlewares/auth.middleware.js";
import contactController from "../../controllers/contact.controller.js";
import {
  validateUserIdParam,
  validateOtherUserIdParam,
  validatePaginationQuery,
  validateAddContactBody,
  validateUpdateNicknameBody,
  validateBulkAddBody,
} from "../../validations/contact.validation.js";

const router = Router();

router.use(authMiddleware);

router.get("/search", contactController.searchUsers);
router.get("/chats", contactController.getChatList);
router.get("/count", contactController.getContactCount);
router.get(
  "/mutual/:otherUserId",
  validateOtherUserIdParam,
  contactController.getMutualContacts,
);
router.post("/bulk", validateBulkAddBody, contactController.bulkAddContacts);
router.get("/", validatePaginationQuery, contactController.getContacts);
router.get("/:userId", validateUserIdParam, contactController.getContactById);
router.post(
  "/:userId",
  validateUserIdParam,
  validateAddContactBody,
  contactController.addContact,
);
router.patch(
  "/:userId",
  validateUserIdParam,
  validateUpdateNicknameBody,
  contactController.updateContactNickname,
);
router.patch(
  "/:userId/nickname",
  validateUserIdParam,
  validateUpdateNicknameBody,
  contactController.updateContactNickname,
);
router.put(
  "/:userId",
  validateUserIdParam,
  validateUpdateNicknameBody,
  contactController.updateContactNickname,
);
router.delete("/:userId", validateUserIdParam, contactController.removeContact);

export default router;
