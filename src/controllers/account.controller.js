import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../utils/api-response.js";
import { clearAuthCookies } from "../helpers/auth/auth-cookies.helper.js";
import * as accountService from "../services/auth/account.service.js";

export const deleteAccount = asyncHandler(async (req, res) => {
  await accountService.deleteAccount({
    userId: req.user._id,
    confirmation: req.body.confirmation,
    password: req.body.password,
    code: req.body.code,
    useRecoveryCode: req.body.useRecoveryCode,
  });

  clearAuthCookies(res);

  return new ApiResponse(
    StatusCodes.OK,
    null,
    "Your account has been permanently deleted.",
  ).send(res);
});

const accountController = {
  deleteAccount,
};

export default accountController;
