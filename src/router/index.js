import express from "express";
import authRoute from "./auth/auth.routes.js";
import usersRoute from "./users/users.routes.js";
import messageRoute from "./message/message.routes.js";
import groupRoute from "./group/group.routes.js";
import aiRoute from "./ai/ai.routes.js";
import callRoute from "./call/call.routes.js";
import groupCallRoute from "./group-call/group-call.routes.js";
import contactsRoute from "./contact/contact.routes.js";

const router = express.Router();

router.use("/auth", authRoute);
router.use("/users", usersRoute);
router.use("/messages", messageRoute);
router.use("/groups", groupRoute);
router.use("/ai", aiRoute);
router.use("/calls", callRoute);
router.use("/group-calls", groupCallRoute);
router.use("/contacts", contactsRoute);

export default router;
