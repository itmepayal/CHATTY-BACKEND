import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import * as aiService from "../services/ai.service.js";
import { AI_SUCCESS_MESSAGES } from "../constants/ai.constants.js";

const aiController = {
  correctEnglish: asyncHandler(async (req, res) => {
    const data = await aiService.correctEnglish(req.body.text);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      AI_SUCCESS_MESSAGES.CORRECT,
    ).send(res);
  }),

  rewriteText: asyncHandler(async (req, res) => {
    const data = await aiService.rewriteText(req.body.text, req.body.tone);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      AI_SUCCESS_MESSAGES.REWRITE,
    ).send(res);
  }),

  hinglishToEnglish: asyncHandler(async (req, res) => {
    const data = await aiService.hinglishToEnglish(req.body.text);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      AI_SUCCESS_MESSAGES.HINGLISH,
    ).send(res);
  }),

  chatbot: asyncHandler(async (req, res) => {
    const data = await aiService.chatbotReply(req.body.messages);
    return new ApiResponse(
      StatusCodes.OK,
      data,
      AI_SUCCESS_MESSAGES.CHATBOT,
    ).send(res);
  }),
};

export default aiController;
