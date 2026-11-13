import { z } from "zod";

export const paginationQuerySchema = z.object({
  page: z.coerce
    .number()
    .int("Page must be an integer.")
    .positive("Page must be a positive integer.")
    .default(1),
  limit: z.coerce
    .number()
    .int("Limit must be an integer.")
    .min(1, "Limit must be at least 1.")
    .max(100, "Limit cannot exceed 100.")
    .default(50),
});
