import { z } from "zod";
import { objectIdSchema } from "../../../shared/validators/object-id.validation.js";

export {
  updatePrivacyBodySchema,
  updateChatPrefsBodySchema,
  updateAppearanceBodySchema,
} from "../../privacy/validations/privacy.validation.js";

export const userIdParamSchema = z.object({
  id: objectIdSchema,
});

export const updateProfileBodySchema = z
  .object({
    fullName: z.string().trim().min(1, "Full name cannot be empty.").optional(),
    username: z.string().trim().optional(),
    bio: z.string().max(250, "Bio cannot exceed 250 characters.").optional(),
    gender: z.string().optional(),
    dob: z.string().optional(),
  })
  .passthrough();

export const publicKeyBodySchema = z.object({
  publicKey: z
    .string({ required_error: "Public key is required." })
    .min(1, "Public key is required."),
});
