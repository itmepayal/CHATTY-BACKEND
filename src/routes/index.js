import { Router } from "express";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import messageRoutes from "./message.routes.js";
import groupRoutes from "./group.routes.js";
import aiRoutes from "./ai.routes.js";
import callRoutes from "./call.routes.js";
import groupCallRoutes from "./group-call.routes.js";
import contactRoutes from "./contact.routes.js";

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
