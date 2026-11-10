import ScheduledMessage from "../models/scheduled-message.model.js";
import { deliverMessage } from "../services/core/message.service.js";
import { assertCanMessage } from "../utils/chat-guard.js";
import { attachLinkPreview } from "../../../shared/utils/link-preview.js";
import { SCHEDULER_TICK_MS } from "../constants/messages.constants.js";

const STRANDED_TIMEOUT_MS = 5 * 60 * 1000;

export const recoverStrandedJobs = async () => {
  try {
    const threshold = new Date(Date.now() - STRANDED_TIMEOUT_MS);
    const result = await ScheduledMessage.updateMany(
      {
        status: "processing",
        updatedAt: { $lte: threshold },
      },
      {
        $set: { status: "pending" },
      },
    );
    if (result.modifiedCount > 0) {
      console.log(
        `[scheduler] Recovered ${result.modifiedCount} stranded scheduled message(s) back to pending.`,
      );
    }
  } catch (err) {
    console.error(
      "[scheduler] Failed to recover stranded jobs:",
      err?.message || err,
    );
  }
};

export const startScheduler = () => {
  recoverStrandedJobs();

  setInterval(async () => {
    try {
      await recoverStrandedJobs();

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
            data: {
              text: s.text,
              e2ee: Boolean(s.e2ee),
              ...(s.iv ? { iv: s.iv } : {}),
            },
          });
          if (!s.e2ee) attachLinkPreview(message);

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
