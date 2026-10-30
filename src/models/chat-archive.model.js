import mongoose from "mongoose";

const ChatArchiveSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    otherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

ChatArchiveSchema.index({ ownerId: 1, otherId: 1 }, { unique: true });

const ChatArchive = mongoose.model("ChatArchive", ChatArchiveSchema);
export default ChatArchive;

export const getArchivedSet = async (ownerId) => {
  const rows = await ChatArchive.find({ ownerId }).select("otherId").lean();
  return new Set(rows.map((r) => r.otherId.toString()));
};
