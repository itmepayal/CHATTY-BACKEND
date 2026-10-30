import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiError from "../utils/api-error.js";
import ApiResponse from "../utils/api-response.js";
import buildChatContents from "../utils/ai-chat-contents.js";
import { callAI, __test__ as serviceTest } from "../services/ai.service.js";
import { SYSTEM_PROMPTS } from "../constants/aiPrompts.js";
import {
  validateText,
  validateTone,
  validateGeneratedText,
} from "../utils/ai-validators.js";
import { parseStructuredGrammar } from "../utils/ai-parsers.js";

const aiController = {
  correctEnglish: asyncHandler(async (req, res) => {
    const text = validateText(req.body?.text);

    const output = await callAI(SYSTEM_PROMPTS.correct, text, true);
    const result = parseStructuredGrammar(output);

    return new ApiResponse(
      StatusCodes.OK,
      {
        original: text,
        corrected: result.corrected,
        changes: result.changes,
      },
      "English corrected successfully",
    ).send(res);
  }),

  rewriteText: asyncHandler(async (req, res) => {
    const text = validateText(req.body?.text);
    const tone = req.body?.tone;

    validateTone(tone);

    const output = await callAI(SYSTEM_PROMPTS.rewrite(tone), text);
    const rewritten = validateGeneratedText(output, "rewrite result");

    return new ApiResponse(
      StatusCodes.OK,
      { original: text, tone, rewritten },
      "Text rewritten successfully",
    ).send(res);
  }),

  hinglishToEnglish: asyncHandler(async (req, res) => {
    const text = validateText(req.body?.text);

    const output = await callAI(SYSTEM_PROMPTS.hinglish, text);
    const translated = validateGeneratedText(output, "translation");

    return new ApiResponse(
      StatusCodes.OK,
      { original: text, translated },
      "Hinglish translated successfully",
    ).send(res);
  }),

  chatbot: asyncHandler(async (req, res) => {
    const messages = buildChatContents(req.body?.messages);

    if (!messages.length || messages[messages.length - 1].role !== "user") {
      throw new ApiError(
        StatusCodes.BAD_REQUEST,
        "Send at least one user message.",
      );
    }

    const output = await callAI(SYSTEM_PROMPTS.chatbot, messages, false, {
      temperature: 0.5,
      maxOutputTokens: 1500,
    });
    const reply = validateGeneratedText(output, "chatbot reply");

    return new ApiResponse(
      StatusCodes.OK,
      { reply },
      "Reply generated successfully",
    ).send(res);
  }),
};

export default aiController;
