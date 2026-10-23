import mongoose from "mongoose";

const MemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: { type: String, enum: ["admin", "member"], default: "member" },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const GroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    avatar: {
      public_id: { type: String },
      url: { type: String },
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: { type: [MemberSchema], default: [] },
    lastMessageAt: { type: Date },
  },
  { timestamps: true },
);

GroupSchema.index({ "members.userId": 1, lastMessageAt: -1 });

const Group = mongoose.model("Group", GroupSchema);
export default Group;
