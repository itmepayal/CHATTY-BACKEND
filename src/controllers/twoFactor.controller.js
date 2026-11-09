import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import {
  accessCookieOptions,
  refreshCookieOptions,
} from "../constants/auth.constants.js";
import * as twoFactorService from "../services/auth/twoFactor.service.js";
import { buildAuthUserPayload } from "../helpers/auth-payload.helper.js";

const twoFactorController = {
  setup2FA: asyncHandler(async (req, res) => {
    const result = await twoFactorService.setup2FA(req.user._id);

    return new ApiResponse(
      StatusCodes.OK,
      result,
      "Scan the QR code with your authenticator app, then verify with a code.",
    ).send(res);
  }),

  enable2FA: asyncHandler(async (req, res) => {
    const { code } = req.body;
    const result = await twoFactorService.enable2FA({
      userId: req.user._id,
      code,
    });

    return new ApiResponse(
      StatusCodes.OK,
      result,
      "Two-step verification enabled successfully.",
    ).send(res);
  }),

  verifyLogin2FA: asyncHandler(async (req, res) => {
    const { challengeToken, code, useRecoveryCode } = req.body;
    const { user, accessToken, refreshToken } =
      await twoFactorService.verifyLogin2FA({
        req,
        challengeToken,
        code,
        useRecoveryCode,
      });

    res
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions);

    return new ApiResponse(
      StatusCodes.OK,
      buildAuthUserPayload(
        user,
        { accessToken, refreshToken },
        { twoFactorEnabled: true, loginAlerts: user.loginAlerts },
      ),
      "Two-factor verification successful.",
    ).send(res);
  }),

  disable2FA: asyncHandler(async (req, res) => {
    const { code } = req.body;
    await twoFactorService.disable2FA({ userId: req.user._id, code });

    return new ApiResponse(
      StatusCodes.OK,
      null,
      "Two-step verification disabled successfully.",
    ).send(res);
  }),

  regenerateRecoveryCodes: asyncHandler(async (req, res) => {
    const { code } = req.body;
    const result = await twoFactorService.regenerateRecoveryCodes({
      userId: req.user._id,
      code,
    });

    return new ApiResponse(
      StatusCodes.OK,
      result,
      "Recovery codes regenerated.",
    ).send(res);
  }),
};

export default twoFactorController;
