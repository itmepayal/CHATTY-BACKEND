import LocationShare from "../models/location-share.model.js";
import { LOCATION_EXPIRY_JOB_INTERVAL_MS } from "../constants/constants.js";

export const startLocationExpiryJob = (io) => {
  let running = false;

  setInterval(async () => {
    if (running) return;
    running = true;

    try {
      const expired = await LocationShare.find({
        status: "active",
        expiresAt: { $lte: new Date() },
      })
        .select("_id sharerId receiverId")
        .lean();

      if (!expired.length) return;

      await LocationShare.updateMany(
        { _id: { $in: expired.map((s) => s._id) } },
        { status: "expired" },
      );

      expired.forEach((s) => {
        io.to(s.sharerId.toString()).emit("location:ended", { shareId: s._id });
        io.to(s.receiverId.toString()).emit("location:ended", {
          shareId: s._id,
        });
      });
    } catch (e) {
      console.error("[location] expiry job failed:", e?.message || e);
    } finally {
      running = false;
    }
  }, LOCATION_EXPIRY_JOB_INTERVAL_MS);
};
