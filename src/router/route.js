import express from "express";
import authRoute from "./auth/route.js";
import usersRoute from "./users/route.js";
import messageRoute from "./message/route.js";
import groupRoute from "./group/route.js";
import aiRoute from "./ai/ai.routes.js";

const router = express.Router();

router.use("/auth", authRoute);
router.use("/users", usersRoute);
router.use("/messages", messageRoute);
router.use("/groups", groupRoute);
router.use("/ai", aiRoute);

export default router;
