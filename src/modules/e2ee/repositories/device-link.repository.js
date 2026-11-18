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
  const cleanPin = String(linkingPin).trim().replace(/[\s-]+/g, "");
  const session = new DeviceLinkSession({
    userId: toObjectId(userId),
    linkSessionId,
    linkingPin: cleanPin,
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

export const findSessionByPin = async (userId, linkingPin) => {
  const clean = String(linkingPin).trim().replace(/[\s-]+/g, "");
  const withHyphen =
    clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;
  const pinCandidates = Array.from(new Set([clean, withHyphen]));

  return DeviceLinkSession.findOne({
    userId: toObjectId(userId),
    linkingPin: { $in: pinCandidates },
  })
    .sort({ createdAt: -1 })
    .lean();
};

export const findPendingSessionByPin = findSessionByPin;

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
  findSessionByPin,
  findPendingSessionByPin,
  approveLinkSession,
  deleteLinkSession,
};
