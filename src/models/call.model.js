import mongoose from "mongoose";
import { CALL_STATUS } from "../constants/calling/call.constants.js";

const CallSchema = mongoose.Schema(
  {
    callId: {
      type: String,
      unique: true,
      sparse: true,
    },
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    receiverId: {
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
    answeredAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },
    duration: {
      type: Number,
      default: 0,
      min: 0,
    },
    endedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true },
);

CallSchema.index({ callerId: 1, createdAt: -1 });
CallSchema.index({ receiverId: 1, createdAt: -1 });
CallSchema.index({ callerId: 1, receiverId: 1, createdAt: -1 });

const Call = mongoose.model("Call", CallSchema);
export default Call;
