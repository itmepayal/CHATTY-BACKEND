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
  requestDeviceLinkSchema,
  approveDeviceLinkSchema,
  linkSessionIdParamSchema,
  linkingPinParamSchema,
  rotateDeviceSchema,
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

router.post(
  "/devices/heartbeat",
  validate(deviceIdParamSchema, "body"),
  e2eeController.heartbeatDevice,
);

router.delete(
  "/devices/:deviceId",
  validate(deviceIdParamSchema, "params"),
  e2eeController.revokeDevice,
);

router.post(
  "/devices/rotate",
  validate(rotateDeviceSchema, "body"),
  e2eeController.rotateDeviceKey,
);

router.post(
  "/devices/public-keys",
  e2eePublicKeysLimiter,
  validate(batchDevicePublicKeysSchema, "body"),
  e2eeController.getDevicesPublicKeys,
);

// Device Linking Routes for Automatic Key Sharing Between Trusted Devices
router.post(
  "/devices/link/request",
  validate(requestDeviceLinkSchema, "body"),
  e2eeController.requestDeviceLink,
);

router.get(
  "/devices/link/status/:linkSessionId",
  validate(linkSessionIdParamSchema, "params"),
  e2eeController.getDeviceLinkStatus,
);

router.get(
  "/devices/link/pin/:linkingPin",
  validate(linkingPinParamSchema, "params"),
  e2eeController.lookupPendingLinkSession,
);

router.post(
  "/devices/link/approve",
  validate(approveDeviceLinkSchema, "body"),
  e2eeController.approveDeviceLink,
);

router.delete(
  "/devices/link/:linkSessionId",
  validate(linkSessionIdParamSchema, "params"),
  e2eeController.cancelDeviceLink,
);

export default router;
