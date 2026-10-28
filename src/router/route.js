import express from "express";
import authRoute from "./auth/route.js";
import usersRoute from "./users/route.js";
import messageRoute from "./message/route.js";
import groupRoute from "./group/route.js";
import aiRoute from "./ai/ai.routes.js";
import callRoute from "./call/router.js";
import groupCallRoute from "./groupCall/router.js";
import contactsRoute from "./contact/contact.route.js";

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
