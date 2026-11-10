import { Router } from "express";
import authRoutes from "../modules/auth/routes/auth.routes.js";
import userRoutes from "../modules/users/routes/user.routes.js";
import messageRoutes from "../modules/messaging/routes/message.routes.js";
import groupRoutes from "../modules/groups/routes/group.routes.js";
import aiRoutes from "../modules/ai/routes/ai.routes.js";
import callRoutes from "../modules/calling/routes/call.routes.js";
import groupCallRoutes from "../modules/calling/routes/group-call.routes.js";
import contactRoutes from "../modules/contacts/routes/contact.routes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/messages", messageRoutes);
router.use("/groups", groupRoutes);
router.use("/ai", aiRoutes);
router.use("/calls", callRoutes);
router.use("/group-calls", groupCallRoutes);
router.use("/contacts", contactRoutes);

export default router;
