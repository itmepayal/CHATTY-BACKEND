import mongoose from "mongoose";

const ContactSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Owner ID is required."],
      index: true,
    },
    contactId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Contact ID is required."],
      validate: {
        validator(v) {
          if (!this.ownerId || !v) return true;
          return this.ownerId.toString() !== v.toString();
        },
        message: "A user cannot add themselves as a contact.",
      },
    },
    nickname: {
      type: String,
      trim: true,
      maxlength: [50, "Nickname cannot exceed 50 characters."],
      set: (v) =>
        typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

ContactSchema.index({ ownerId: 1, contactId: 1 }, { unique: true });

ContactSchema.index({ contactId: 1, ownerId: 1 });

ContactSchema.index({ ownerId: 1, createdAt: -1 });

ContactSchema.pre("save", function (next) {
  if (
    this.ownerId &&
    this.contactId &&
    this.ownerId.toString() === this.contactId.toString()
  ) {
    return next(new Error("A user cannot add themselves as a contact."));
  }
  next();
});

export const isContact = async (ownerId, contactId) => {
  if (!ownerId || !contactId || ownerId.toString() === contactId.toString()) {
    return false;
  }
  return Boolean(await Contact.exists({ ownerId, contactId }));
};

export const isMutualContact = async (a, b) => {
  if (!a || !b || a.toString() === b.toString()) {
    return false;
  }
  const count = await Contact.countDocuments({
    $or: [
      { ownerId: a, contactId: b },
      { ownerId: b, contactId: a },
    ],
  });
  return count === 2;
};

ContactSchema.statics.isContact = isContact;
ContactSchema.statics.isMutualContact = isMutualContact;

const Contact = mongoose.model("Contact", ContactSchema);
export default Contact;
