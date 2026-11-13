import express from "express";
import authMiddleware from "../../../middlewares/auth.middleware.js";
import { validate } from "../../../middlewares/validation/validate.middleware.js";
import {
  e2eeRegisterLimiter,
  e2eeBackupLimiter,
  e2eeResetLimiter,
  e2eePublicKeysLimiter,
} from "../../../middlewares/rateLimit/index.js";
import e2eeController from "../controllers/e2ee.controller.js";
import {
  registerKeysSchema,
  updateBackupSchema,
  resetKeysSchema,
  batchPublicKeysSchema,
  targetUserParamSchema,
  registerDeviceSchema,
  deviceIdParamSchema,
  batchDevicePublicKeysSchema,
} from "../validations/e2ee.validation.js";

const router = express.Router();

// Require authentication for all E2EE operations
router.use(authMiddleware);

// Status
router.get("/status", e2eeController.getStatus);

// Key registration (initial)
router.post(
  "/keys",
  e2eeRegisterLimiter,
  validate(registerKeysSchema, "body"),
  e2eeController.registerKeys,
);

// Encrypted backup operations
router
  .route("/backup")
  .get(e2eeBackupLimiter, e2eeController.getBackup)
  .put(
    e2eeBackupLimiter,
    validate(updateBackupSchema, "body"),
    e2eeController.updateBackup,
  );

// Key reset
router.post(
  "/reset",
  e2eeResetLimiter,
  validate(resetKeysSchema, "body"),
  e2eeController.resetKeys,
);

// Public key lookup
router.get(
  "/public-key/:id",
  validate(targetUserParamSchema, "params"),
  e2eeController.getPublicKey,
);

// Batch public keys lookup
router.post(
  "/public-keys",
  e2eePublicKeysLimiter,
  validate(batchPublicKeysSchema, "body"),
  e2eeController.getPublicKeysBatch,
);

// Device Registry Routes for Multi-Device E2EE
router
  .route("/devices")
  .get(e2eeController.getDevices)
  .post(
    e2eeRegisterLimiter,
    validate(registerDeviceSchema, "body"),
    e2eeController.registerDevice,
  );

router.delete(
  "/devices/:deviceId",
  validate(deviceIdParamSchema, "params"),
  e2eeController.revokeDevice,
);

router.post(
  "/devices/public-keys",
  e2eePublicKeysLimiter,
  validate(batchDevicePublicKeysSchema, "body"),
  e2eeController.getDevicesPublicKeys,
);

export default router;
