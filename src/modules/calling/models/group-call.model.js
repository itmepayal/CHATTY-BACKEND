import mongoose from "mongoose";
import { CALL_STATUS } from "../constants/call.constants.js";

const GroupCallSchema = mongoose.Schema(
  {
    callId: {
      type: String,
      unique: true,
      sparse: true,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
      index: true,
    },
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["audio", "video"],
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(CALL_STATUS),
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    endedAt: {
      type: Date,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
    participants: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    maxParticipants: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  { timestamps: true },
);

GroupCallSchema.index({ groupId: 1, createdAt: -1 });
GroupCallSchema.index({ startedBy: 1, createdAt: -1 });
GroupCallSchema.index({ participants: 1, createdAt: -1 });

const GroupCall = mongoose.model("GroupCall", GroupCallSchema);
export default GroupCall;
