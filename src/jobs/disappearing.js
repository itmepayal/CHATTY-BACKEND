import Message from "../models/message.model.js";
import { io } from "../lib/socket.js";
import { wipeMessage } from "../utils/message-cleanup.js";
import { emitConversationUpdate } from "../utils/message-helpers.js";
import { DISAPPEARING_SWEEP_INTERVAL_MS } from "../constants/constants.js";

let started = false;

export const startDisappearingSweeper = () => {
  if (started) return;
  started = true;

  setInterval(async () => {
    try {
      const expired = await Message.find({
        expiresAt: { $lte: new Date() },
        isDeleted: { $ne: true },
      }).limit(200);

      for (const m of expired) {
        await wipeMessage(m);

        io.to(String(m.senderId))
          .to(String(m.receiverId))
          .emit("messageDeleted", { messageId: m._id });

        await Promise.all([
          emitConversationUpdate(m.senderId, m.receiverId),
          emitConversationUpdate(m.receiverId, m.senderId),
        ]);
      }
    } catch (e) {
      console.error("[disappearing] sweep failed:", e?.message || e);
    }
  }, DISAPPEARING_SWEEP_INTERVAL_MS);
};
