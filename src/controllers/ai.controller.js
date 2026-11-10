import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../utils/api-response.js";
import { AI_SUCCESS_MESSAGES } from "../constants/ai/ai.constants.js";
import * as aiService from "../services/ai/ai.service.js";

export const correctEnglish = asyncHandler(async (req, res) => {
  const data = await aiService.correctEnglish(req.body.text);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    AI_SUCCESS_MESSAGES.CORRECT,
  ).send(res);
});

export const rewriteText = asyncHandler(async (req, res) => {
  const data = await aiService.rewriteText(req.body.text, req.body.tone);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    AI_SUCCESS_MESSAGES.REWRITE,
  ).send(res);
});

export const hinglishToEnglish = asyncHandler(async (req, res) => {
  const data = await aiService.hinglishToEnglish(req.body.text);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    AI_SUCCESS_MESSAGES.HINGLISH,
  ).send(res);
});

export const chatbot = asyncHandler(async (req, res) => {
  const data = await aiService.chatbotReply(req.body.messages);

  return new ApiResponse(
    StatusCodes.OK,
    data,
    AI_SUCCESS_MESSAGES.CHATBOT,
  ).send(res);
});

const aiController = {
  correctEnglish,
  rewriteText,
  hinglishToEnglish,
  chatbot,
};

export default aiController;
