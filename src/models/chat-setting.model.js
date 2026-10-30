import mongoose from "mongoose";

const ChatSettingSchema = new mongoose.Schema(
  {
    pairKey: { type: String, required: true, unique: true },
    disappearAfter: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

const ChatSetting = mongoose.model("ChatSetting", ChatSettingSchema);

export default ChatSetting;

export const ALLOWED_TIMERS = [0, 86400, 604800, 7776000];

export const pairKeyOf = (a, b) => [String(a), String(b)].sort().join("_");

export const getDisappearAfter = async (a, b) => {
  const s = await ChatSetting.findOne({ pairKey: pairKeyOf(a, b) })
    .select("disappearAfter")
    .lean();
  return s?.disappearAfter || 0;
};

export const getExpiry = async (a, b) => {
  const seconds = await getDisappearAfter(a, b);
  return seconds ? new Date(Date.now() + seconds * 1000) : undefined;
};
