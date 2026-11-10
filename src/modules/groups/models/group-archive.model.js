import mongoose from "mongoose";

const GroupArchiveSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
  },
  { timestamps: true },
);

GroupArchiveSchema.index({ ownerId: 1, groupId: 1 }, { unique: true });
GroupArchiveSchema.index({ groupId: 1 });

const GroupArchive = mongoose.model("GroupArchive", GroupArchiveSchema);
export default GroupArchive;

export const getArchivedGroupSet = async (ownerId) => {
  const rows = await GroupArchive.find({ ownerId }).select("groupId").lean();
  return new Set(rows.map((r) => r.groupId.toString()));
};
