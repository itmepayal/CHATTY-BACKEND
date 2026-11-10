import { startLocationExpirySweeper } from "../utils/locationSharing.js";
import { LOCATION_EXPIRY_JOB_INTERVAL_MS } from "../constants/messages.constants.js";

export const startLocationExpiryJob = (
  io,
  intervalMs = LOCATION_EXPIRY_JOB_INTERVAL_MS,
) => {
  return startLocationExpirySweeper(io, intervalMs);
};
