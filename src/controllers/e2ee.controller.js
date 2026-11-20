import mongoose from "mongoose";
import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/api-error.js";
import ApiResponse from "../utils/api-response.js";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import User from "../models/users.model.js";
import Device from "../models/device.model.js";
import E2EEBackup from "../models/e2ee-backup.model.js";
import DeviceLinkSession from "../models/device-link-session.model.js";
import GroupKey from "../models/group-key.model.js";
import Session from "../models/session.model.js";
import { io, disconnectDeviceSockets } from "../lib/socket.js";
import { assertValidId } from "../utils/validators.js";

const RESET_CONFIRM_KEYWORD = "RESET_E2EE_IDENTITY";

const isValidPublicJwk = (pk) =>
  Boolean(
    pk &&
      pk.kty === "EC" &&
      pk.crv === "P-256" &&
      typeof pk.x === "string" &&
      typeof pk.y === "string" &&
      pk.x.length > 0 &&
      pk.y.length > 0,
  );

const e2eeController = {
  getStatus: asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const [user, backup, deviceCount] = await Promise.all([
      User.findById(userId).select("+publicKey publicKeyUpdatedAt").lean(),
      E2EEBackup.findOne({ userId }).lean(),
      Device.countDocuments({ userId, status: { $ne: "REVOKED" } }),
    ]);

    const hasPublicKey = Boolean(user?.publicKey);
    const hasBackup = Boolean(backup?.encryptedPrivateKey);

    return new ApiResponse(
      StatusCodes.OK,
      {
        hasPublicKey,
        hasKey: hasPublicKey,
        hasBackup,
        backupVersion: backup?.backupVersion || null,
        backupUpdatedAt: backup?.backupUpdatedAt || null,
        publicKeyUpdatedAt: user?.publicKeyUpdatedAt || null,
        deviceCount,
      },
      "E2EE status retrieved.",
    ).send(res);
  }),

  registerKeys: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { publicKey, encryptedPrivateKey, backupVersion = 1, deviceId, deviceName } =
      req.body;

    if (!isValidPublicJwk(publicKey)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Invalid public key.");
    }
    if (!encryptedPrivateKey || typeof encryptedPrivateKey !== "string") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Encrypted private key backup is required.",
      );
    }

    const cleanPublicKey = {
      kty: "EC",
      crv: "P-256",
      x: publicKey.x,
      y: publicKey.y,
    };

    const user = await User.findById(userId).select("+publicKey");
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    if (
      user.publicKey &&
      (user.publicKey.x !== cleanPublicKey.x ||
        user.publicKey.y !== cleanPublicKey.y)
    ) {
      if (req.body.replace !== true) {
        throw new ApiError(
          StatusCodes.CONFLICT,
          "A public key already exists. Use backup restore or device linking instead.",
        );
      }
    }

    const now = new Date();
    user.publicKey = cleanPublicKey;
    user.publicKeyUpdatedAt = now;
    await user.save();

    const backup = await E2EEBackup.findOneAndUpdate(
      { userId },
      {
        userId,
        encryptedPrivateKey,
        backupVersion: Number(backupVersion) || 1,
        backupUpdatedAt: now,
      },
      { upsert: true, new: true },
    );

    if (deviceId) {
      await Device.findOneAndUpdate(
        { userId, deviceId },
        {
          userId,
          deviceId,
          publicKey: cleanPublicKey,
          deviceName: deviceName || "Primary Device",
          status: "VERIFIED",
          lastActive: now,
          revokedAt: null,
        },
        { upsert: true },
      );
    }

    io.to(String(userId)).emit("e2ee:backup:updated", {
      hasBackup: true,
      backupVersion: backup.backupVersion,
      backupUpdatedAt: backup.backupUpdatedAt,
    });

    return new ApiResponse(
      StatusCodes.OK,
      {
        publicKey: cleanPublicKey,
        publicKeyUpdatedAt: now,
        hasBackup: true,
        backupVersion: backup.backupVersion,
        backupUpdatedAt: backup.backupUpdatedAt,
      },
      "E2EE keys registered successfully.",
    ).send(res);
  }),

  getBackup: asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const backup = await E2EEBackup.findOne({ userId }).lean();
    if (!backup || !backup.encryptedPrivateKey) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        "No encrypted backup found on server.",
      );
    }

    return new ApiResponse(
      StatusCodes.OK,
      {
        encryptedPrivateKey: backup.encryptedPrivateKey,
        backupVersion: backup.backupVersion || 1,
        backupUpdatedAt: backup.backupUpdatedAt || backup.updatedAt,
      },
      "Encrypted backup fetched successfully.",
    ).send(res);
  }),

  updateBackup: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { encryptedPrivateKey, backupVersion } = req.body;

    if (!encryptedPrivateKey || typeof encryptedPrivateKey !== "string") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Valid encrypted private key is required.",
      );
    }

    const now = new Date();
    const update = {
      encryptedPrivateKey,
      backupUpdatedAt: now,
    };
    if (backupVersion && Number.isInteger(Number(backupVersion))) {
      update.backupVersion = Number(backupVersion);
    }

    const backup = await E2EEBackup.findOneAndUpdate({ userId }, update, {
      upsert: true,
      new: true,
    });

    io.to(String(userId)).emit("e2ee:backup:updated", {
      hasBackup: true,
      backupVersion: backup.backupVersion,
      backupUpdatedAt: backup.backupUpdatedAt,
    });

    return new ApiResponse(
      StatusCodes.OK,
      {
        hasBackup: true,
        backupVersion: backup.backupVersion,
        backupUpdatedAt: backup.backupUpdatedAt,
      },
      "Encrypted backup updated.",
    ).send(res);
  }),

  resetIdentity: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { password, confirm } = req.body;

    if (confirm !== RESET_CONFIRM_KEYWORD) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        `Confirmation keyword must be "${RESET_CONFIRM_KEYWORD}".`,
      );
    }

    const user = await User.findById(userId).select("+password");
    if (!user) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

    if (!(await user.isPassword(String(password || "")))) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Password is incorrect.");
    }

    await Promise.all([
      User.findByIdAndUpdate(userId, {
        $set: { publicKey: null, publicKeyUpdatedAt: null },
      }),
      E2EEBackup.deleteMany({ userId }),
      Device.updateMany(
        { userId },
        { $set: { status: "REVOKED", revokedAt: new Date() } },
      ),
      DeviceLinkSession.deleteMany({ userId }),
      GroupKey.deleteMany({ userId }),
    ]);

    io.to(String(userId)).emit("e2ee:reset", {
      userId: String(userId),
      timestamp: new Date().toISOString(),
    });

    return new ApiResponse(
      StatusCodes.OK,
      { reset: true, warning: "E2EE identity has been reset." },
      "E2EE identity reset successfully.",
    ).send(res);
  }),

  getDevices: asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const devices = await Device.find({ userId })
      .sort({ lastActive: -1 })
      .lean();

    const formatted = devices.map((d) => ({
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      deviceType: d.deviceType,
      status: d.status,
      publicKey: d.publicKey,
      lastActive: d.lastActive || d.updatedAt,
      createdAt: d.createdAt,
    }));

    return new ApiResponse(
      StatusCodes.OK,
      { devices: formatted },
      "Devices fetched successfully.",
    ).send(res);
  }),

  registerDevice: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { deviceId, publicKey, deviceName, deviceType } = req.body;

    if (!deviceId || typeof deviceId !== "string" || deviceId.trim().length === 0) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Valid device ID is required.");
    }
    if (!isValidPublicJwk(publicKey)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Valid public key is required.");
    }

    const cleanDeviceId = deviceId.trim();
    const cleanKey = {
      kty: "EC",
      crv: "P-256",
      x: publicKey.x,
      y: publicKey.y,
    };

    const existing = await Device.findOne({ userId, deviceId: cleanDeviceId });
    if (existing?.status === "REVOKED") {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "This device has been revoked and cannot be re-registered.",
      );
    }

    const now = new Date();
    const device = await Device.findOneAndUpdate(
      { userId, deviceId: cleanDeviceId },
      {
        userId,
        deviceId: cleanDeviceId,
        publicKey: cleanKey,
        deviceName: deviceName ? String(deviceName).trim().slice(0, 100) : "Device",
        ...(deviceType ? { deviceType } : {}),
        status: "VERIFIED",
        lastActive: now,
      },
      { upsert: true, new: true },
    );

    io.to(String(userId)).emit("e2ee:device:registered", {
      deviceId: cleanDeviceId,
      deviceName: device.deviceName,
      publicKey: cleanKey,
    });

    return new ApiResponse(
      StatusCodes.OK,
      {
        registered: true,
        deviceId: cleanDeviceId,
        deviceName: device.deviceName,
        status: device.status,
      },
      "Device registered successfully.",
    ).send(res);
  }),

  heartbeatDevice: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const deviceId = req.body.deviceId || req.params.deviceId;

    if (!deviceId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Device ID is required.");
    }

    const device = await Device.findOne({ userId, deviceId });
    if (device?.status === "REVOKED") {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "This device is revoked.",
        "DEVICE_REVOKED",
      );
    }

    const now = new Date();
    if (device) {
      device.lastActive = now;
      await device.save();
    }

    return new ApiResponse(
      StatusCodes.OK,
      { success: true, deviceId, lastActive: now },
      "Heartbeat recorded.",
    ).send(res);
  }),

  revokeDevice: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { deviceId } = req.params;

    if (!deviceId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Device ID is required.");
    }

    const now = new Date();
    const device = await Device.findOneAndUpdate(
      { userId, deviceId },
      { $set: { status: "REVOKED", revokedAt: now } },
      { new: true },
    );

    if (!device) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Device not found.");
    }

    io.to(String(userId)).emit("e2ee:device:revoked", { deviceId });

    await disconnectDeviceSockets(userId, deviceId);

    return new ApiResponse(
      StatusCodes.OK,
      { revoked: true, deviceId, revokedAt: now },
      "Device revoked successfully.",
    ).send(res);
  }),

  rotateDeviceKey: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { deviceId, newPublicKey, deviceName } = req.body;

    if (!deviceId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Device ID is required.");
    }
    if (!isValidPublicJwk(newPublicKey)) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Valid new public key required.");
    }

    const cleanKey = {
      kty: "EC",
      crv: "P-256",
      x: newPublicKey.x,
      y: newPublicKey.y,
    };

    const device = await Device.findOne({ userId, deviceId });
    if (!device || device.status === "REVOKED") {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "Device not found or revoked.",
      );
    }

    device.publicKey = cleanKey;
    device.keyVersion = (device.keyVersion || 1) + 1;
    device.lastActive = new Date();
    if (deviceName) device.deviceName = deviceName;
    await device.save();

    io.to(String(userId)).emit("e2ee:device:rotated", {
      deviceId,
      publicKey: cleanKey,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { rotated: true, deviceId, keyVersion: device.keyVersion },
      "Device key rotated successfully.",
    ).send(res);
  }),

  getDevicesPublicKeys: asyncHandler(async (req, res) => {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) {
      return new ApiResponse(
        StatusCodes.OK,
        { devices: [], userDevices: {}, count: 0 },
        "No user IDs provided.",
      ).send(res);
    }

    const validUserIds = [
      ...new Set(userIds.filter((id) => mongoose.Types.ObjectId.isValid(id))),
    ];

    const [activeDevices, users] = await Promise.all([
      Device.find({
        userId: { $in: validUserIds },
        status: { $ne: "REVOKED" },
      }).lean(),
      User.find({
        _id: { $in: validUserIds },
      })
        .select("+publicKey")
        .lean(),
    ]);

    const userDevices = {};
    for (const uid of validUserIds) {
      userDevices[uid] = [];
    }

    for (const d of activeDevices) {
      const uid = String(d.userId);
      if (userDevices[uid]) {
        userDevices[uid].push({
          deviceId: d.deviceId,
          publicKey: d.publicKey,
        });
      }
    }

    // Fallback: If user has no explicit device entries, but has User.publicKey, add default device
    for (const u of users) {
      const uid = String(u._id);
      if (userDevices[uid] && userDevices[uid].length === 0 && u.publicKey) {
        userDevices[uid].push({
          deviceId: "default",
          publicKey: u.publicKey,
        });
      }
    }

    const allDevices = [];
    for (const [uid, devs] of Object.entries(userDevices)) {
      for (const d of devs) {
        allDevices.push({
          userId: uid,
          deviceId: d.deviceId,
          publicKey: d.publicKey,
        });
      }
    }

    return new ApiResponse(
      StatusCodes.OK,
      {
        devices: allDevices,
        userDevices,
        count: allDevices.length,
      },
      "Device public keys fetched.",
    ).send(res);
  }),

  getBatchPublicKeys: asyncHandler(async (req, res) => {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || !userIds.length) {
      return new ApiResponse(
        StatusCodes.OK,
        { keys: [], publicKeys: {}, count: 0 },
        "No user IDs provided.",
      ).send(res);
    }

    const validUserIds = [
      ...new Set(userIds.filter((id) => mongoose.Types.ObjectId.isValid(id))),
    ];

    const users = await User.find({ _id: { $in: validUserIds } })
      .select("+publicKey")
      .lean();

    const publicKeys = {};
    const keys = [];

    for (const u of users) {
      const uid = String(u._id);
      const hasKey = Boolean(u.publicKey);
      if (hasKey) publicKeys[uid] = u.publicKey;
      keys.push({
        userId: uid,
        hasKey,
        publicKey: u.publicKey || null,
      });
    }

    return new ApiResponse(
      StatusCodes.OK,
      { keys, publicKeys, count: keys.length },
      "Public keys fetched.",
    ).send(res);
  }),

  requestDeviceLink: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { ephemeralPublicKey, deviceId, deviceName } = req.body;

    if (!isValidPublicJwk(ephemeralPublicKey)) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Valid ephemeral public key is required.",
      );
    }
    if (!deviceId) {
      throw new ApiError(StatusCodes.BAD_REQUEST, "Device ID is required.");
    }

    const pinNumber = Math.floor(100000 + Math.random() * 900000).toString();
    const linkSessionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

    const session = await DeviceLinkSession.create({
      linkSessionId,
      userId,
      linkingPin: pinNumber,
      newDeviceId: String(deviceId).trim(),
      newDeviceName: deviceName ? String(deviceName).trim() : "New Device",
      ephemeralPublicKey,
      status: "pending",
      expiresAt,
    });

    io.to(String(userId)).emit("e2ee:device-link:requested", {
      linkSessionId: session.linkSessionId,
      linkingPin: session.linkingPin,
      newDeviceId: session.newDeviceId,
      newDeviceName: session.newDeviceName,
      expiresAt: session.expiresAt,
    });

    return new ApiResponse(
      StatusCodes.CREATED,
      {
        linkSessionId: session.linkSessionId,
        linkingPin: session.linkingPin,
        expiresAt: session.expiresAt,
      },
      "Device link request created.",
    ).send(res);
  }),

  getDeviceLinkStatus: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { linkSessionId } = req.params;

    const session = await DeviceLinkSession.findOne({
      linkSessionId,
      userId,
    }).lean();

    if (!session) {
      throw new ApiError(StatusCodes.NOT_FOUND, "Linking session not found.");
    }

    return new ApiResponse(
      StatusCodes.OK,
      {
        linkSessionId: session.linkSessionId,
        linkingPin: session.linkingPin,
        status: session.status,
        encryptedPayload: session.encryptedPayload || null,
        expiresAt: session.expiresAt,
      },
      "Link session status.",
    ).send(res);
  }),

  lookupPendingLinkSession: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { linkingPin } = req.params;

    const cleanPin = String(linkingPin || "")
      .trim()
      .replace(/[\s-]+/g, "");

    const session = await DeviceLinkSession.findOne({
      userId,
      linkingPin: cleanPin,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        "No pending device linking session found for this PIN.",
      );
    }

    session.status = "connecting";
    await session.save();

    io.to(String(userId)).emit("e2ee:device-link:connecting", {
      linkSessionId: session.linkSessionId,
    });

    return new ApiResponse(
      StatusCodes.OK,
      {
        linkSessionId: session.linkSessionId,
        linkingPin: session.linkingPin,
        ephemeralPublicKey: session.ephemeralPublicKey,
        newDeviceId: session.newDeviceId,
        newDeviceName: session.newDeviceName,
        expiresAt: session.expiresAt,
      },
      "Pending linking request found.",
    ).send(res);
  }),

  approveDeviceLink: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { linkSessionId, linkingPin, encryptedPayload, approverDeviceId } =
      req.body;

    const query = { userId, status: { $in: ["pending", "connecting"] } };
    if (linkSessionId) {
      query.linkSessionId = linkSessionId;
    } else if (linkingPin) {
      query.linkingPin = String(linkingPin).trim().replace(/[\s-]+/g, "");
    } else {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "linkSessionId or linkingPin is required.",
      );
    }

    const session = await DeviceLinkSession.findOne(query);
    if (!session || session.expiresAt < new Date()) {
      throw new ApiError(
        StatusCodes.NOT_FOUND,
        "Device link session expired or not found.",
      );
    }

    if (
      !encryptedPayload ||
      !encryptedPayload.ephemeralPublicKey ||
      !encryptedPayload.iv ||
      !encryptedPayload.ciphertext
    ) {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Valid encrypted payload is required.",
      );
    }

    session.encryptedPayload = encryptedPayload;
    session.approverDeviceId = approverDeviceId || "existing-device";
    session.status = "approved";
    await session.save();

    io.to(String(userId)).emit("e2ee:device-link:approved", {
      linkSessionId: session.linkSessionId,
      encryptedPayload,
    });

    return new ApiResponse(
      StatusCodes.OK,
      {
        success: true,
        linkSessionId: session.linkSessionId,
        status: "approved",
      },
      "Device link approved.",
    ).send(res);
  }),

  cancelDeviceLink: asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const { linkSessionId } = req.params;

    const session = await DeviceLinkSession.findOneAndUpdate(
      { linkSessionId, userId },
      { status: "cancelled" },
      { new: true },
    );

    io.to(String(userId)).emit("e2ee:device-link:cancelled", {
      linkSessionId,
    });

    return new ApiResponse(
      StatusCodes.OK,
      { cancelled: true, linkSessionId },
      "Device link session cancelled.",
    ).send(res);
  }),
};

export default e2eeController;
