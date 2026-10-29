import LocationShare from "../models/LocationShare.model.js";

const MIN_INTERVAL_MS = 2000;
const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const registerLocationHandlers = (
  io,
  socket,
  { isBlockedEitherWay },
) => {
  const userId = socket.data.userId;
  const lastEmitAt = new Map();

  socket.on("location:update", async (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};

    try {
      const { shareId, lat, lng, accuracy, heading, speed } = payload || {};

      if (!isObjectId(shareId))
        return done({ ok: false, error: "invalid_share" });
      if (
        !isNum(lat) ||
        !isNum(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return done({ ok: false, error: "invalid_coords" });
      }

      // rate limit
      const now = Date.now();
      if (now - (lastEmitAt.get(shareId) || 0) < MIN_INTERVAL_MS) {
        return done({ ok: true, skipped: true });
      }
      lastEmitAt.set(shareId, now);

      const updatedAt = new Date();

      // sirf owner + active + expire nahi hua
      const share = await LocationShare.findOneAndUpdate(
        {
          _id: shareId,
          sharerId: userId,
          status: "active",
          expiresAt: { $gt: updatedAt },
        },
        {
          $set: {
            lastLocation: {
              lat,
              lng,
              accuracy: isNum(accuracy) ? accuracy : undefined,
              heading: isNum(heading) ? heading : undefined,
              speed: isNum(speed) ? speed : undefined,
              updatedAt,
            },
          },
        },
        { new: true },
      );

      if (!share) {
        lastEmitAt.delete(shareId);
        // receiver ko expiry sweeper (neeche) "ended" bhej dega
        socket.emit("location:ended", { shareId });
        return done({ ok: false, error: "share_inactive" });
      }

      const receiverId = share.receiverId.toString();

      if (await isBlockedEitherWay(userId, receiverId)) {
        await LocationShare.updateOne(
          { _id: share._id },
          { status: "stopped", endedAt: new Date() },
        );
        lastEmitAt.delete(shareId);
        io.to(receiverId).emit("location:ended", { shareId });
        io.to(userId).emit("location:ended", { shareId });
        return done({ ok: false, error: "blocked" });
      }

      const out = {
        shareId: String(share._id),
        lat,
        lng,
        accuracy,
        heading,
        speed,
        updatedAt,
      };

      // receiver ko bhi, aur sharer ko bhi (taaki uska apna map/"Updated" bhi chale)
      io.to(receiverId).emit("location:update", out);
      io.to(userId).emit("location:update", out);

      done({ ok: true });
    } catch (e) {
      console.error("[location] update failed:", e?.message || e);
      done({ ok: false, error: "server_error" });
    }
  });
};

/**
 * Expire hue shares ko band karta hai aur dono users ko "location:ended" bhejta hai.
 * Sharer ka tab band ho gaya ho tab bhi receiver ka card "ended" ho jata hai.
 * Server start par SIRF EK baar call karo.
 */
export const startLocationExpirySweeper = (io, everyMs = 30_000) => {
  const timer = setInterval(async () => {
    try {
      const now = new Date();
      const expired = await LocationShare.find({
        status: "active",
        expiresAt: { $lte: now },
      }).select("_id sharerId receiverId");

      if (!expired.length) return;

      await LocationShare.updateMany(
        { _id: { $in: expired.map((s) => s._id) }, status: "active" },
        { status: "expired", endedAt: now },
      );

      for (const s of expired) {
        const payload = { shareId: String(s._id) };
        io.to(s.sharerId.toString()).emit("location:ended", payload);
        io.to(s.receiverId.toString()).emit("location:ended", payload);
      }
    } catch (e) {
      console.error("[location] expiry sweep failed:", e?.message || e);
    }
  }, everyMs);

  timer.unref?.();
  return timer;
};
