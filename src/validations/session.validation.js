import { z } from "zod";
import { objectIdSchema } from "./common.validation.js";

export const sessionIdParamSchema = z.object({
  sessionId: objectIdSchema,
});
