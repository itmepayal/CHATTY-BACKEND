import { StatusCodes } from "http-status-codes";
import * as savedMessageService from "../services/saved/saved-message.service.js";

export const saveMessage = async (req, res, next) => {
  try {
    const { messageId, messageModel, category, folder, tags, note } = req.body;
    const result = await savedMessageService.saveMessage({
      userId: req.user._id,
      messageId,
      messageModel,
      category,
      folder,
      tags,
      note,
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Message saved successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const createNote = async (req, res, next) => {
  try {
    const { note, category, folder, tags } = req.body;
    const result = await savedMessageService.createPersonalNote({
      userId: req.user._id,
      note,
      category,
      folder,
      tags,
    });

    return res.status(StatusCodes.CREATED).json({
      success: true,
      message: "Note saved successfully.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const unsaveMessage = async (req, res, next) => {
  try {
    const savedMessageId = req.params.id;
    const result = await savedMessageService.unsaveMessage({
      userId: req.user._id,
      savedMessageId,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Saved item removed.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const updateSavedMessage = async (req, res, next) => {
  try {
    const savedMessageId = req.params.id;
    const result = await savedMessageService.updateSavedMessage({
      userId: req.user._id,
      savedMessageId,
      updates: req.body,
    });

    return res.status(StatusCodes.OK).json({
      success: true,
      message: "Saved item updated.",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const getSavedMessages = async (req, res, next) => {
  try {
    const { category, folder, tag, chatType, q, isPinned, page, limit } = req.query;
    const result = await savedMessageService.getSavedMessages({
      userId: req.user._id,
      category,
      folder,
      tag,
      chatType,
      q,
      isPinned: isPinned !== undefined ? isPinned === "true" : undefined,
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

export const getSavedMeta = async (req, res, next) => {
  try {
    const result = await savedMessageService.getCategoriesAndFolders(req.user._id);

    return res.status(StatusCodes.OK).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
