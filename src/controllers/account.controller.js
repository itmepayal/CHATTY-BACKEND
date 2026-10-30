import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import { StatusCodes } from "http-status-codes";
import { options as cookieOptions } from "../constants/constants.js";
import { deleteUserAccount } from "../services/account-deletion.service.js";

const accountController = {
  deleteAccount: asyncHandler(async (req, res) => {
    const { confirmation, password, code, useRecoveryCode } = req.body;

    await deleteUserAccount({
      userId: req.user._id,
      confirmation,
      password,
      code,
      useRecoveryCode,
    });

    res
      .clearCookie("accessToken", cookieOptions)
      .clearCookie("refreshToken", cookieOptions);

    return new ApiResponse(
      StatusCodes.OK,
      null,
      "Your account has been permanently deleted.",
    ).send(res);
  }),
};

export default accountController;
