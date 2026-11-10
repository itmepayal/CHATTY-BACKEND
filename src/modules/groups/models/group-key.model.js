import mongoose from "mongoose";

const GroupKeySchema = new mongoose.Schema(
  {
    groupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    version: { type: Number, default: 1 },
    wrappedKey: { type: String, required: true },
    iv: { type: String, required: true },
    wrappedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

GroupKeySchema.index({ groupId: 1, userId: 1, version: 1 }, { unique: true });

const GroupKey = mongoose.model("GroupKey", GroupKeySchema);
export default GroupKey;
