import LocationShare from "../models/LocationShare.model.js";
import GroupMessage from "../models/groupmessage.model.js";
import { groupRoom } from "../lib/socket.js";

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

  socket.on("disconnect", () => lastEmitAt.clear());

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

      const now = Date.now();
      if (now - (lastEmitAt.get(shareId) || 0) < MIN_INTERVAL_MS) {
        return done({ ok: true, skipped: true });
      }
      lastEmitAt.set(shareId, now);

      const updatedAt = new Date();

      const share = await LocationShare.findOneAndUpdate(
        {
          _id: shareId,
          sharerId: userId,
          receiverId: { $ne: null },
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

      const saved = share.lastLocation;
      const out = {
        shareId: String(share._id),
        lat: saved.lat,
        lng: saved.lng,
        accuracy: saved.accuracy,
        heading: saved.heading,
        speed: saved.speed,
        updatedAt,
      };

      io.to(receiverId).emit("location:update", out);
      io.to(userId).emit("location:update", out);

      done({ ok: true });
    } catch (e) {
      console.error("[location] update failed:", e?.message || e);
      done({ ok: false, error: "server_error" });
    }
  });
};

export const startLocationExpirySweeper = (io, everyMs = 30_000) => {
  let running = false;

  const timer = setInterval(async () => {
    if (running) return;
    running = true;

    try {
      const now = new Date();
      const expired = await LocationShare.find({
        status: "active",
        expiresAt: { $lte: now },
      })
        .select("_id sharerId receiverId groupId")
        .lean();

      if (!expired.length) return;

      const ids = expired.map((s) => s._id);

      await LocationShare.updateMany(
        { _id: { $in: ids }, status: "active" },
        { status: "expired", endedAt: now },
      );

      await GroupMessage.updateMany(
        { "location.shareId": { $in: ids } },
        { "location.isLive": false },
      );

      for (const s of expired) {
        const sharer = String(s.sharerId);

        if (s.receiverId) {
          const payload = { shareId: String(s._id) };
          io.to(sharer).emit("location:ended", payload);
          io.to(String(s.receiverId)).emit("location:ended", payload);
        } else if (s.groupId) {
          const payload = {
            groupId: String(s.groupId),
            shareId: String(s._id),
          };
          io.to(groupRoom(s.groupId)).emit("group:location:ended", payload);
          io.to(sharer).emit("group:location:ended", payload);
        }
      }
    } catch (e) {
      console.error("[location] expiry sweep failed:", e?.message || e);
    } finally {
      running = false;
    }
  }, everyMs);

  timer.unref?.();
  return timer;
};
