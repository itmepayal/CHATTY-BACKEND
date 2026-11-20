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

export const computeNextOccurrence = (scheduledFor, recurrence) => {
  if (!recurrence || !recurrence.type || recurrence.type === "none") return null;
  const current = new Date(scheduledFor);
  const interval = Math.max(1, recurrence.interval || 1);
  let next = new Date(current);

  if (recurrence.type === "daily") {
    next.setDate(next.getDate() + interval);
  } else if (recurrence.type === "weekly") {
    next.setDate(next.getDate() + 7 * interval);
  } else if (recurrence.type === "monthly") {
    next.setMonth(next.getMonth() + interval);
  } else if (recurrence.type === "custom") {
    if (Array.isArray(recurrence.daysOfWeek) && recurrence.daysOfWeek.length > 0) {
      const days = [...recurrence.daysOfWeek].sort((a, b) => a - b);
      let found = false;
      for (let i = 1; i <= 7; i++) {
        const candidate = new Date(current);
        candidate.setDate(candidate.getDate() + i);
        if (days.includes(candidate.getDay())) {
          next = candidate;
          found = true;
          break;
        }
      }
      if (!found) next.setDate(next.getDate() + interval);
    } else {
      next.setDate(next.getDate() + interval);
    }
  }

  if (recurrence.endDate && next > new Date(recurrence.endDate)) {
    return null;
  }
  const nextOccur = (recurrence.currentOccurrence || 1) + 1;
  if (recurrence.maxOccurrences && nextOccur > recurrence.maxOccurrences) {
    return null;
  }

  return { nextDate: next, currentOccurrence: nextOccur };
};

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
        status: { $in: ["pending", "scheduled"] },
        scheduledFor: { $lte: new Date() },
      }).limit(50);

      for (const s of due) {
        // Atomic lease acquisition to prevent race conditions across server instances
        const claimed = await ScheduledMessage.findOneAndUpdate(
          { _id: s._id, status: { $in: ["pending", "scheduled"] } },
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

            if (claimed.recurrence && claimed.recurrence.type && claimed.recurrence.type !== "none") {
              const nextPlan = computeNextOccurrence(claimed.scheduledFor, claimed.recurrence);
              if (nextPlan) {
                await ScheduledMessage.create({
                  senderId: claimed.senderId,
                  groupId: claimed.groupId,
                  messageType: "group",
                  text: claimed.text,
                  image: claimed.image,
                  file: claimed.file,
                  audio: claimed.audio,
                  video: claimed.video,
                  e2ee: claimed.e2ee,
                  iv: claimed.iv,
                  groupKeyVersion: claimed.groupKeyVersion,
                  scheduledFor: nextPlan.nextDate,
                  timezone: claimed.timezone || "UTC",
                  recurrence: {
                    ...(claimed.recurrence.toObject ? claimed.recurrence.toObject() : claimed.recurrence),
                    currentOccurrence: nextPlan.currentOccurrence,
                  },
                  status: "pending",
                });
              }
            }

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
                image: claimed.image,
                file: claimed.file,
                audio: claimed.audio,
                video: claimed.video,
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

            if (claimed.recurrence && claimed.recurrence.type && claimed.recurrence.type !== "none") {
              const nextPlan = computeNextOccurrence(claimed.scheduledFor, claimed.recurrence);
              if (nextPlan) {
                await ScheduledMessage.create({
                  senderId: claimed.senderId,
                  receiverId: claimed.receiverId,
                  messageType: "direct",
                  text: claimed.text,
                  image: claimed.image,
                  file: claimed.file,
                  audio: claimed.audio,
                  video: claimed.video,
                  e2ee: claimed.e2ee,
                  iv: claimed.iv,
                  keyEnvelopes: claimed.keyEnvelopes,
                  scheduledFor: nextPlan.nextDate,
                  timezone: claimed.timezone || "UTC",
                  recurrence: {
                    ...(claimed.recurrence.toObject ? claimed.recurrence.toObject() : claimed.recurrence),
                    currentOccurrence: nextPlan.currentOccurrence,
                  },
                  status: "pending",
                });
              }
            }

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
