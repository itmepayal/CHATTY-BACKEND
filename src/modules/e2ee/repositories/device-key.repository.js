import DeviceKey from "../models/device-key.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const upsertDeviceKey = async (
  userId,
  { deviceId, publicKey, deviceName },
  options = {},
) => {
  const query = DeviceKey.findOneAndUpdate(
    {
      userId: toObjectId(userId),
      deviceId: String(deviceId),
    },
    {
      $set: {
        publicKey,
        deviceName: deviceName || "Web Browser",
        isRevoked: false,
        lastActiveAt: new Date(),
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      ...options,
    },
  );

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const findActiveDevicesForUser = async (userId, options = {}) => {
  const query = DeviceKey.find({
    userId: toObjectId(userId),
    isRevoked: false,
  }).select("userId deviceId publicKey deviceName lastActiveAt createdAt");

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const findActiveDevicesForUsers = async (userIds, options = {}) => {
  const objectIds = (userIds || []).map(toObjectId);
  const query = DeviceKey.find({
    userId: { $in: objectIds },
    isRevoked: false,
  }).select("userId deviceId publicKey deviceName lastActiveAt createdAt");

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const revokeDevice = async (userId, deviceId, options = {}) => {
  const query = DeviceKey.findOneAndUpdate(
    {
      userId: toObjectId(userId),
      deviceId: String(deviceId),
    },
    {
      $set: {
        isRevoked: true,
        lastActiveAt: new Date(),
      },
    },
    {
      new: true,
      ...options,
    },
  );

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updateDeviceActivity = async (userId, deviceId, options = {}) => {
  const query = DeviceKey.updateOne(
    {
      userId: toObjectId(userId),
      deviceId: String(deviceId),
      isRevoked: false,
    },
    {
      $set: {
        lastActiveAt: new Date(),
      },
    },
    options,
  );

  if (options.session) query.session(options.session);

  return query;
};

export const deleteDevicesForUser = async (userId, options = {}) => {
  const query = DeviceKey.deleteMany(
    {
      userId: toObjectId(userId),
    },
    options,
  );

  if (options.session) query.session(options.session);

  return query;
};

const deviceKeyRepository = Object.freeze({
  upsertDeviceKey,
  findActiveDevicesForUser,
  findActiveDevicesForUsers,
  revokeDevice,
  updateDeviceActivity,
  deleteDevicesForUser,
});

export default deviceKeyRepository;
