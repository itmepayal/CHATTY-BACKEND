import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import { getIp } from "../../../shared/utils/device-info.js";
import { buildAuthUserPayload } from "../helpers/auth-payload.helper.js";
import { setAuthCookies } from "../helpers/auth-cookies.helper.js";
import * as twoFactorService from "../services/twoFactor.service.js";

export const setup2FA = asyncHandler(async (req, res) => {
  const result = await twoFactorService.setup2FA(req.user._id);

  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Scan the QR code with your authenticator app, then verify with a code.",
  ).send(res);
});

export const enable2FA = asyncHandler(async (req, res) => {
  const result = await twoFactorService.enable2FA({
    userId: req.user._id,
    code: req.body.code,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Two-step verification enabled successfully.",
  ).send(res);
});

export const verifyLogin2FA = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } =
    await twoFactorService.verifyLogin2FA({
      challengeToken: req.body.challengeToken,
      code: req.body.code,
      useRecoveryCode: req.body.useRecoveryCode,
      userAgent: req.headers["user-agent"],
      ip: getIp(req),
    });

  setAuthCookies(res, accessToken, refreshToken);

  return new ApiResponse(
    StatusCodes.OK,
    buildAuthUserPayload(
      user,
      { accessToken, refreshToken },
      { twoFactorEnabled: true, loginAlerts: user.loginAlerts },
    ),
    "Two-factor verification successful.",
  ).send(res);
});

export const disable2FA = asyncHandler(async (req, res) => {
  await twoFactorService.disable2FA({
    userId: req.user._id,
    code: req.body.code,
  });

  return new ApiResponse(
    StatusCodes.OK,
    null,
    "Two-step verification disabled successfully.",
  ).send(res);
});

export const regenerateRecoveryCodes = asyncHandler(async (req, res) => {
  const result = await twoFactorService.regenerateRecoveryCodes({
    userId: req.user._id,
    code: req.body.code,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result,
    "Recovery codes regenerated.",
  ).send(res);
});

const twoFactorController = {
  setup2FA,
  enable2FA,
  verifyLogin2FA,
  disable2FA,
  regenerateRecoveryCodes,
};

export default twoFactorController;
