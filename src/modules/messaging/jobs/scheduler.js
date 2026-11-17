import ScheduledMessage from "../models/scheduled-message.model.js";
import { deliverMessage } from "../services/core/message.service.js";
import { sendGroupMessageService } from "../../groups/services/group-message.service.js";
import { getGroupAndMember } from "../../groups/helpers/group.member.helpers.js";
import { assertCanMessage } from "../utils/chat-guard.js";
import { attachLinkPreview } from "../../../shared/utils/link-preview.js";
import { SCHEDULER_TICK_MS } from "../constants/messages.constants.js";
import { io } from "../../../infrastructure/socket/socket.js";

const STRANDED_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_JOB_RETRIES = 3;

export const recoverStrandedJobs = async () => {
  try {
    const threshold = new Date(Date.now() - STRANDED_TIMEOUT_MS);

    // First, mark jobs that have timed out repeatedly as failed
    await ScheduledMessage.updateMany(
      {
        status: "processing",
        updatedAt: { $lte: threshold },
        retryCount: { $gte: MAX_JOB_RETRIES },
      },
      {
        $set: {
          status: "failed",
          error: "Job timed out repeatedly during processing.",
        },
      },
    );

    // Recover other stranded jobs back to pending and increment retry count
    const result = await ScheduledMessage.updateMany(
      {
        status: "processing",
        updatedAt: { $lte: threshold },
        retryCount: { $lt: MAX_JOB_RETRIES },
      },
      {
        $set: { status: "pending" },
        $inc: { retryCount: 1 },
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
        // Atomic lease acquisition to prevent race conditions across server instances
        const claimed = await ScheduledMessage.findOneAndUpdate(
          { _id: s._id, status: "pending" },
          {
            status: "processing",
            processingStartedAt: new Date(),
          },
          { new: true },
        );
        if (!claimed) continue;

        try {
          if (claimed.messageType === "group") {
            // Group Scheduled Message delivery
            const { group } = await getGroupAndMember(
              claimed.groupId,
              claimed.senderId,
            );

            const result = await sendGroupMessageService({
              group,
              me: claimed.senderId,
              body: {
                text: claimed.text,
                encrypted: claimed.e2ee ? "true" : undefined,
                e2ee: claimed.e2ee ? "true" : undefined,
                ...(claimed.iv ? { iv: claimed.iv } : {}),
                ...(claimed.groupKeyVersion != null
                  ? { keyVersion: String(claimed.groupKeyVersion) }
                  : {}),
              },
            });

            const sentId = result?.payload?._id || result?.payload?.id;

            await ScheduledMessage.updateOne(
              { _id: claimed._id },
              { status: "sent", sentMessageId: sentId },
            );

            try {
              io.to(claimed.senderId.toString()).emit("scheduled:sent", {
                scheduleId: claimed._id,
                messageId: sentId,
                groupId: claimed.groupId,
              });
            } catch (_err) {}
          } else {
            // Direct 1:1 Scheduled Message delivery
            await assertCanMessage(claimed.senderId, claimed.receiverId);

            const { message } = await deliverMessage({
              senderId: claimed.senderId,
              receiverId: claimed.receiverId,
              data: {
                text: claimed.text,
                e2ee: Boolean(claimed.e2ee),
                ...(claimed.iv ? { iv: claimed.iv } : {}),
                ...(claimed.e2ee &&
                Array.isArray(claimed.keyEnvelopes) &&
                claimed.keyEnvelopes.length > 0
                  ? { keyEnvelopes: claimed.keyEnvelopes }
                  : {}),
              },
            });

            if (!claimed.e2ee) attachLinkPreview(message);

            await ScheduledMessage.updateOne(
              { _id: claimed._id },
              { status: "sent", sentMessageId: message._id },
            );

            try {
              io.to(claimed.senderId.toString()).emit("scheduled:sent", {
                scheduleId: claimed._id,
                messageId: message._id,
                receiverId: claimed.receiverId,
              });
            } catch (_err) {}
          }
        } catch (e) {
          const errMsg = String(e?.message || e).slice(0, 200);
          console.error(
            `[scheduler] Failed to deliver scheduled message ${claimed._id}:`,
            errMsg,
          );

          await ScheduledMessage.updateOne(
            { _id: claimed._id },
            {
              status: "failed",
              error: errMsg,
            },
          );

          try {
            io.to(claimed.senderId.toString()).emit("scheduled:failed", {
              scheduleId: claimed._id,
              error: errMsg,
              receiverId: claimed.receiverId,
              groupId: claimed.groupId,
            });
          } catch (_err) {}
        }
      }
    } catch (e) {
      console.error("[scheduler] tick failed:", e?.message || e);
    }
  }, SCHEDULER_TICK_MS);
};
