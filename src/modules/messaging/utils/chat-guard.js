import { StatusCodes } from "http-status-codes";
import User from "../../users/models/users.model.js";
import Contact from "../../contacts/models/contact.model.js";
import ApiError from "../../../shared/errors/api-error.js";

const hasBlocked = (user, otherId) =>
  user?.blockedUsers?.some((b) => String(b) === String(otherId));

export const assertCanMessage = async (senderId, receiverId) => {
  const [sender, receiver] = await Promise.all([
    User.findById(senderId).select("blockedUsers"),
    User.findById(receiverId).select("blockedUsers status"),
  ]);

  if (!receiver || receiver.status === "suspended") {
    throw new ApiError(StatusCodes.NOT_FOUND, "User not found.");
  }

  if (hasBlocked(sender, receiverId)) {
    throw new ApiError(
      StatusCodes.FORBIDDEN,
      "Unblock this user to send messages.",
    );
  }

  if (hasBlocked(receiver, senderId)) {
    throw new ApiError(StatusCodes.FORBIDDEN, "You can't message this user.");
  }

  const isMutual = await Contact.isMutualContact(senderId, receiverId);
  if (!isMutual) {
    const err = new ApiError(
      StatusCodes.FORBIDDEN,
      "You must become contacts before sending messages.",
    );
    err.code = "CONTACT_NOT_ACCEPTED";
    throw err;
  }
};
