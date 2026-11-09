import User from "../../models/users.model.js";
import ApiError from "../../utils/api-error.js";
import { StatusCodes } from "http-status-codes";

/**
 * Moved from services/message.service.js:L30-50
 */
export const assertE2EEReady = async (senderId, receiverId) => {
  const users = await User.find({
    _id: { $in: [senderId, receiverId] },
  }).select("+publicKey");

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
