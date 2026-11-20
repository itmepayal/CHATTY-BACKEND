import mongoose from "mongoose";

export const CONTACT_REQUEST_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  CANCELLED: "cancelled",
});

const ContactRequestSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Sender ID is required."],
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Recipient ID is required."],
      validate: {
        validator(v) {
          if (!this.senderId || !v) return true;
          return this.senderId.toString() !== v.toString();
        },
        message: "A user cannot send a contact request to themselves.",
      },
    },
    status: {
      type: String,
      enum: Object.values(CONTACT_REQUEST_STATUS),
      default: CONTACT_REQUEST_STATUS.PENDING,
      index: true,
    },
    note: {
      type: String,
      trim: true,
      maxlength: [200, "Note cannot exceed 200 characters."],
      default: "",
    },
    respondedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

ContactRequestSchema.index(
  { senderId: 1, recipientId: 1, status: 1 },
  { background: true },
);

ContactRequestSchema.index(
  { recipientId: 1, status: 1, createdAt: -1 },
  { background: true },
);

ContactRequestSchema.index(
  { senderId: 1, status: 1, createdAt: -1 },
  { background: true },
);

const ContactRequest = mongoose.model("ContactRequest", ContactRequestSchema);

export default ContactRequest;
