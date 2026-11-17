import DeviceLinkSession from "../models/device-link-session.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const createLinkSession = async ({
  userId,
  linkSessionId,
  linkingPin,
  ephemeralPublicKey,
  newDeviceId,
  newDeviceName,
  expiresAt,
}) => {
  const session = new DeviceLinkSession({
    userId: toObjectId(userId),
    linkSessionId,
    linkingPin,
    ephemeralPublicKey,
    newDeviceId,
    newDeviceName,
    expiresAt,
    status: "pending",
  });
  return session.save();
};

export const findLinkSessionById = async (linkSessionId) => {
  return DeviceLinkSession.findOne({ linkSessionId }).lean();
};

export const findPendingSessionByPin = async (userId, linkingPin) => {
  const clean = String(linkingPin).trim().replace(/\s+/g, "");
  const withHyphen = clean.includes("-")
    ? clean
    : `${clean.slice(0, 3)}-${clean.slice(3)}`;
  const withoutHyphen = clean.replace(/-/g, "");

  return DeviceLinkSession.findOne({
    userId: toObjectId(userId),
    linkingPin: { $in: [clean, withHyphen, withoutHyphen] },
    status: "pending",
    expiresAt: { $gt: new Date() },
  }).lean();
};

export const approveLinkSession = async (
  linkSessionId,
  { encryptedPayload, approverDeviceId },
) => {
  return DeviceLinkSession.findOneAndUpdate(
    { linkSessionId, status: "pending" },
    {
      $set: {
        status: "approved",
        encryptedPayload,
        approverDeviceId,
      },
    },
    { new: true, runValidators: true },
  ).lean();
};

export const deleteLinkSession = async (linkSessionId) => {
  return DeviceLinkSession.deleteOne({ linkSessionId });
};

export default {
  createLinkSession,
  findLinkSessionById,
  findPendingSessionByPin,
  approveLinkSession,
  deleteLinkSession,
};
