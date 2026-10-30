import ScheduledMessage from "../models/scheduled-message.model.js";
import { deliverMessage } from "../services/message.service.js";
import { assertCanMessage } from "../utils/chat-guard.js";
import { attachLinkPreview } from "../utils/link-preview.js";
import { SCHEDULER_TICK_MS } from "../constants/constants.js";

export const startScheduler = () => {
  setInterval(async () => {
    try {
      const due = await ScheduledMessage.find({
        status: "pending",
        scheduledFor: { $lte: new Date() },
      }).limit(50);

      for (const s of due) {
        const claimed = await ScheduledMessage.findOneAndUpdate(
          { _id: s._id, status: "pending" },
          { status: "processing" },
        );
        if (!claimed) continue;

        try {
          await assertCanMessage(s.senderId, s.receiverId);

          const { message } = await deliverMessage({
            senderId: s.senderId,
            receiverId: s.receiverId,
            data: { text: s.text },
          });
          attachLinkPreview(message);

          await ScheduledMessage.updateOne(
            { _id: s._id },
            { status: "sent", sentMessageId: message._id },
          );
        } catch (e) {
          await ScheduledMessage.updateOne(
            { _id: s._id },
            {
              status: "failed",
              error: String(e?.message || e).slice(0, 200),
            },
          );
        }
      }
    } catch (e) {
      console.error("[scheduler] tick failed:", e?.message || e);
    }
  }, SCHEDULER_TICK_MS);
};
