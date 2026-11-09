import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { StatusCodes } from "http-status-codes";
import {
  accessCookieOptions,
  refreshCookieOptions,
} from "../constants/auth.constants.js";
import { deleteAccount } from "../services/auth/account.service.js";

const accountController = {
  deleteAccount: asyncHandler(async (req, res) => {
    const { confirmation, password, code, useRecoveryCode } = req.body;

    await deleteAccount({
      userId: req.user._id,
      confirmation,
      password,
      code,
      useRecoveryCode,
    });

    res
      .clearCookie("accessToken", accessCookieOptions)
      .clearCookie("refreshToken", refreshCookieOptions);

    return new ApiResponse(
      StatusCodes.OK,
      null,
      "Your account has been permanently deleted.",
    ).send(res);
  }),
};

export default accountController;
