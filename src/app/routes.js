import { Router } from "express";
import authRoutes from "../modules/auth/routes/auth.routes.js";
import userRoutes from "../modules/users/routes/user.routes.js";
import messageRoutes from "../modules/messaging/routes/message.routes.js";
import scheduledRoutes from "../modules/messaging/routes/scheduled.routes.js";
import groupRoutes from "../modules/groups/routes/group.routes.js";
import aiRoutes from "../modules/ai/routes/ai.routes.js";
import callRoutes from "../modules/calling/routes/call.routes.js";
import groupCallRoutes from "../modules/calling/routes/group-call.routes.js";
import contactRoutes from "../modules/contacts/routes/contact.routes.js";
import { e2eeRoutes, e2eeMessageRoutes } from "../modules/e2ee/index.js";
import settingsRoutes from "../modules/notifications/routes/notification-settings.routes.js";
import notificationRoutes from "../modules/notifications/routes/notification.routes.js";
import savedMessageRoutes from "../modules/messaging/routes/saved-message.routes.js";
import advancedMessagingRoutes from "../modules/messaging/routes/advanced-messaging.routes.js";
import giftRoutes from "../modules/gifts/routes/gift.routes.js";

const router = Router();

router.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/settings", settingsRoutes);
router.use("/notifications", notificationRoutes);
router.use("/saved-messages", savedMessageRoutes);
router.use("/e2ee", e2eeRoutes);
router.use("/messages/e2ee", e2eeMessageRoutes);
router.use("/messages", advancedMessagingRoutes);
router.use("/messages", messageRoutes);
router.use("/scheduled", scheduledRoutes);
router.use("/groups", groupRoutes);
router.use("/ai", aiRoutes);
router.use("/calls", callRoutes);
router.use("/group-calls", groupCallRoutes);
router.use("/contacts", contactRoutes);
router.use("/gifts", giftRoutes);

export default router;
