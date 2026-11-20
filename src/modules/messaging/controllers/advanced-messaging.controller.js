import { StatusCodes } from "http-status-codes";
import * as reactionService from "../services/reactions/reaction.service.js";
import * as threadService from "../services/threads/thread.service.js";
import * as pollService from "../services/polls/poll.service.js";
import * as disappearingService from "../services/disappearing/disappearing.service.js";

// Reactions
export const toggleReaction = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.body?.isGroup);
    const groupId = req.params.groupId || req.body?.groupId || null;
    const messageId = req.params.messageId;
    const { emoji, allowMultiple } = req.body || {};

    const result = await reactionService.toggleReaction({
      userId: req.user._id,
      messageId,
      emoji,
      isGroup,
      groupId,
      allowMultiple: Boolean(allowMultiple),
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: result.action === "removed" ? "Reaction removed." : "Reaction updated.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getReactionDetails = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.query.isGroup === "true");
    const groupId = req.params.groupId || req.query.groupId || null;
    const messageId = req.params.messageId;

    const result = await reactionService.getReactionDetails({
      userId: req.user._id,
      messageId,
      isGroup,
      groupId,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// Threads
export const getThread = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.query.isGroup === "true");
    const groupId = req.params.groupId || req.query.groupId || null;
    const parentMessageId = req.params.messageId;
    const { page, limit } = req.query;

    const result = await threadService.getThread({
      userId: req.user._id,
      parentMessageId,
      isGroup,
      groupId,
      page,
      limit,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const sendThreadReply = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.body?.isGroup);
    const groupId = req.params.groupId || req.body?.groupId || null;
    const parentMessageId = req.params.messageId;

    const result = await threadService.sendThreadReply({
      userId: req.user._id,
      parentMessageId,
      body: req.body || {},
      isGroup,
      groupId,
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Thread reply sent.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// Polls
export const createPoll = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.body?.isGroup);
    const targetId = req.params.groupId || req.body?.receiverId || req.body?.groupId || req.body?.targetId;
    const { question, options, isAnonymous, allowMultipleAnswers, canChangeVote, expiresAt } = req.body || {};

    const result = await pollService.createPoll({
      userId: req.user._id,
      targetId,
      isGroup,
      question,
      options,
      isAnonymous,
      allowMultipleAnswers,
      canChangeVote,
      expiresAt,
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Poll created successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const castVote = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.body?.isGroup);
    const groupId = req.params.groupId || req.body?.groupId || null;
    const messageId = req.params.messageId || req.body?.messageId;
    const rawOptions = req.body?.optionIds ?? req.body?.optionId;
    const optionIds = Array.isArray(rawOptions)
      ? rawOptions
      : rawOptions !== undefined && rawOptions !== null
        ? [rawOptions]
        : [];

    const result = await pollService.castVote({
      userId: req.user._id,
      messageId,
      isGroup,
      groupId,
      optionIds,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Vote cast successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const closePoll = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.body?.isGroup);
    const groupId = req.params.groupId || req.body?.groupId || null;
    const messageId = req.params.messageId || req.body?.messageId;

    const result = await pollService.closePoll({
      userId: req.user._id,
      messageId,
      isGroup,
      groupId,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Poll closed.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getPollDetails = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.query.isGroup === "true");
    const groupId = req.params.groupId || req.query.groupId || null;
    const messageId = req.params.messageId;

    const result = await pollService.getPollDetails({
      userId: req.user._id,
      messageId,
      isGroup,
      groupId,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// Disappearing & View-Once
export const setGroupDisappearing = async (req, res, next) => {
  try {
    const groupId = req.params.groupId || req.params.id;
    const { seconds } = req.body || {};

    const result = await disappearingService.setGroupDisappearing({
      userId: req.user._id,
      groupId,
      seconds,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Group disappearing messages setting updated.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const markViewOnceOpened = async (req, res, next) => {
  try {
    const isGroup = Boolean(req.params.groupId || req.body?.isGroup);
    const groupId = req.params.groupId || req.body?.groupId || null;
    const messageId = req.params.messageId;

    const result = await disappearingService.markViewOnceOpened({
      userId: req.user._id,
      messageId,
      isGroup,
      groupId,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
