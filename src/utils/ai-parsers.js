import { StatusCodes } from "http-status-codes";
import ApiError from "./api-error.js";
import { sanitizeText } from "./ai-validators.js";

const invalidGrammar = () =>
  new ApiError(
    StatusCodes.BAD_GATEWAY,
    "AI service returned an invalid grammar response.",
  );

export const parseStructuredGrammar = (rawOutput) => {
  if (typeof rawOutput !== "string") throw invalidGrammar();

  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw invalidGrammar();
  }

  if (!parsed || typeof parsed !== "object") throw invalidGrammar();

  const corrected = sanitizeText(parsed.corrected);
  if (!corrected) throw invalidGrammar();

  if (
    Array.isArray(parsed.changes) &&
    parsed.changes.some((item) => typeof item !== "string")
  ) {
    throw invalidGrammar();
  }

  const changes = Array.isArray(parsed.changes)
    ? parsed.changes.map((item) => sanitizeText(item)).filter(Boolean)
    : [];

  return { corrected, changes };
};
