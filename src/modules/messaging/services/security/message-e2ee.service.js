import { StatusCodes } from "http-status-codes";
import * as userRepository from "../../../users/repositories/user.repository.js";
import ApiError from "../../../../shared/errors/api-error.js";

export const assertE2EEReady = async (senderId, receiverId) => {
  const users = await userRepository
    .find({
      _id: { $in: [senderId, receiverId] },
    })
    .select("+publicKey");

  const hasKey = (id) =>
    users.some((u) => String(u._id) === String(id) && Boolean(u.publicKey));

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
