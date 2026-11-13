import express from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import { validate } from "../../../middlewares/validation/validate.middleware.js";
import { e2eePublicKeysLimiter } from "../../../middlewares/rateLimit/index.js";
import e2eeController from "../controllers/e2ee.controller.js";
import {
  batchPublicKeysSchema,
  targetUserParamSchema,
  batchDevicePublicKeysSchema,
} from "../validations/e2ee.validation.js";

const router = express.Router();

router.use(authMiddleware);

// GET /api/messages/e2ee/public-key/:id
router.get(
  "/public-key/:id",
  validate(targetUserParamSchema, "params"),
  e2eeController.getPublicKey,
);

// POST /api/messages/e2ee/public-keys
router.post(
  "/public-keys",
  e2eePublicKeysLimiter,
  validate(batchPublicKeysSchema, "body"),
  e2eeController.getPublicKeysBatch,
);

// POST /api/messages/e2ee/devices/public-keys
router.post(
  "/devices/public-keys",
  e2eePublicKeysLimiter,
  validate(batchDevicePublicKeysSchema, "body"),
  e2eeController.getDevicesPublicKeys,
);

export default router;
