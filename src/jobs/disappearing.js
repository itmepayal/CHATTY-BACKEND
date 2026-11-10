import Message from "../models/message.model.js";
import { io } from "../lib/socket.js";
import { wipeMessage } from "../utils/message-cleanup.js";
import { emitConversationUpdate } from "../utils/message-helpers.js";
import { DISAPPEARING_SWEEP_INTERVAL_MS } from "../constants/messaging/messages.constants.js";

export const sweepDisappearingMessages = async () => {
  try {
    const expired = await Message.find({
      expiresAt: { $lte: new Date() },
      isDeleted: { $ne: true },
    }).limit(200);

    if (!expired.length) return 0;

    const updatedConversations = new Map();

    for (const m of expired) {
      await wipeMessage(m);

      io.to(String(m.senderId))
        .to(String(m.receiverId))
        .emit("messageDeleted", { messageId: m._id });

      const u1 = String(m.senderId);
      const u2 = String(m.receiverId);
      const pairKey = u1 < u2 ? `${u1}:${u2}` : `${u2}:${u1}`;

      if (!updatedConversations.has(pairKey)) {
        updatedConversations.set(pairKey, [u1, u2]);
      }
    }

    for (const [u1, u2] of updatedConversations.values()) {
      await Promise.allSettled([
        emitConversationUpdate(u1, u2),
        emitConversationUpdate(u2, u1),
      ]);
    }

    return expired.length;
  } catch (e) {
    console.error("[disappearing] sweep failed:", e?.message || e);
    return 0;
  }
};

let started = false;

export const startDisappearingSweeper = () => {
  if (started) return;
  started = true;

  setInterval(sweepDisappearingMessages, DISAPPEARING_SWEEP_INTERVAL_MS);
};
