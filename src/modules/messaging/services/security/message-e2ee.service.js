import { StatusCodes } from "http-status-codes";
import * as userRepository from "../../../users/repositories/user.repository.js";
import * as deviceKeyRepository from "../../../e2ee/repositories/device-key.repository.js";
import ApiError from "../../../../shared/errors/api-error.js";

export const assertE2EEReady = async (senderId, receiverId) => {
  const [users, activeDevices] = await Promise.all([
    userRepository
      .find({
        _id: { $in: [senderId, receiverId] },
      })
      .select("+publicKey"),
    deviceKeyRepository.findActiveDevicesForUsers([senderId, receiverId]),
  ]);

  const hasKey = (id) => {
    const sId = String(id);
    const userHasKey = users.some(
      (u) => String(u._id) === sId && Boolean(u.publicKey),
    );
    const deviceHasKey = (activeDevices || []).some(
      (d) => String(d.userId) === sId && Boolean(d.publicKey),
    );
    return userHasKey || deviceHasKey;
  };

  if (!hasKey(senderId)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "Set up encryption on your device first.",
    );
  }
  if (!hasKey(receiverId)) {
    throw new ApiError(
      StatusCodes.CONFLICT,
      "This user hasn't enabled encryption yet.",
    );
  }
};

const messageE2eeService = {
  assertE2EEReady,
};

export default messageE2eeService;
