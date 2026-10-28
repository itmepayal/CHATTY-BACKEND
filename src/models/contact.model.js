import mongoose from "mongoose";

const ContactSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    nickname: { type: String, trim: true, maxlength: 40 },
  },
  { timestamps: true },
);

ContactSchema.index({ ownerId: 1, contactId: 1 }, { unique: true });
ContactSchema.index({ contactId: 1, ownerId: 1 });

const Contact = mongoose.model("Contact", ContactSchema);
export default Contact;

export const isContact = async (ownerId, contactId) =>
  !!(await Contact.exists({ ownerId, contactId }));

export const isMutualContact = async (a, b) =>
  (await Contact.countDocuments({
    $or: [
      { ownerId: a, contactId: b },
      { ownerId: b, contactId: a },
    ],
  })) === 2;
