import { StatusCodes } from "http-status-codes";
import ApiError from "../utils/apiError.js";
import User from "../models/user.model.js";
import Contact from "../models/contact.model.js";

export const assertCanMessage = async (senderId, receiverId) => {
  const receiver = await User.findById(receiverId).select(
    "blockedUsers whoCanMessage",
  );
  if (!receiver) throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");

  if (receiver.blockedUsers.some((id) => String(id) === String(senderId)))
    throw new ApiError(StatusCodes.FORBIDDEN, "You can't message this user.");

  if (receiver.whoCanMessage === "contacts") {
    const allowed = await Contact.exists({
      ownerId: receiverId,
      contactId: senderId,
    });
    if (!allowed)
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        "This user only accepts messages from contacts.",
      );
  }
};
