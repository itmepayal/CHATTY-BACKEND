import asyncHandler from "../../../middlewares/asyncHandler.middleware.js";
import { StatusCodes } from "http-status-codes";
import ApiResponse from "../../../shared/responses/api-response.js";
import { getIp } from "../../../shared/utils/device-info.js";
import { buildAuthUserPayload } from "../helpers/auth-payload.helper.js";
import {
  setAuthCookies,
  clearAuthCookies,
} from "../helpers/auth-cookies.helper.js";
import * as authService from "../services/auth.service.js";
import * as passwordService from "../services/password.service.js";
import * as tokenService from "../services/token.service.js";

const sessionContext = (req) => ({
  userAgent: req.headers["user-agent"],
  ip: getIp(req),
});

export const registerUser = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.register({
    fullName: req.body.fullName,
    email: req.body.email,
    password: req.body.password,
    file: req.file,
    ...sessionContext(req),
  });

  setAuthCookies(res, accessToken, refreshToken);

  return new ApiResponse(
    StatusCodes.CREATED,
    buildAuthUserPayload(user, { accessToken, refreshToken }),
    "User registered successfully",
  ).send(res);
});

export const loginUser = asyncHandler(async (req, res) => {
  const result = await authService.login({
    email: req.body.email,
    password: req.body.password,
    ...sessionContext(req),
  });

  if (result.twoFactorRequired) {
    return new ApiResponse(
      StatusCodes.OK,
      {
        twoFactorRequired: true,
        challengeToken: result.challengeToken,
      },
      "Two-factor verification required.",
    ).send(res);
  }

  setAuthCookies(res, result.accessToken, result.refreshToken);

  return new ApiResponse(
    StatusCodes.OK,
    buildAuthUserPayload(
      result.user,
      { accessToken: result.accessToken, refreshToken: result.refreshToken },
      { twoFactorEnabled: false, loginAlerts: result.user.loginAlerts },
    ),
    "User login successfully",
  ).send(res);
});

export const refreshToken = asyncHandler(async (req, res) => {
  const tokens = await tokenService.rotateTokens(
    tokenService.extractRefreshToken(req),
  );

  setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

  return new ApiResponse(
    StatusCodes.OK,
    { token: tokens },
    "Tokens refreshed successfully.",
  ).send(res);
});

export const logoutUser = asyncHandler(async (req, res) => {
  const result = await authService.logout({
    accessToken:
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", ""),
    refreshToken: tokenService.extractRefreshToken(req),
  });

  clearAuthCookies(res);

  return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
});

export const checkAuth = asyncHandler(async (req, res) => {
  const safeUser = authService.getAuthenticatedUser(req.user);

  return new ApiResponse(
    StatusCodes.OK,
    buildAuthUserPayload(safeUser, null, {
      status: safeUser.status || "active",
      twoFactorEnabled: safeUser.twoFactorEnabled ?? false,
      loginAlerts: safeUser.loginAlerts ?? true,
    }),
    "Authenticated user fetched successfully",
  ).send(res);
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await passwordService.requestPasswordReset({
    email: req.body.email,
    platform: req.body.platform,
  });

  return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
});

export const openAppResetPassword = asyncHandler(async (req, res) => {
  const html = passwordService.getOpenAppResetHtml(req.params.token);

  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });

  return res.status(StatusCodes.OK).type("html").send(html);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await passwordService.resetPassword({
    token: req.params.token,
    password: req.body.password,
    confirmPassword: req.body.confirmPassword,
  });

  return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await passwordService.changePassword({
    userId: req.user._id,
    currentSessionId: req.sessionId,
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
    confirmPassword: req.body.confirmPassword,
  });

  return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
});

export const updateLoginAlerts = asyncHandler(async (req, res) => {
  const result = await authService.updateLoginAlerts({
    userId: req.user._id,
    enabled: req.body.enabled,
  });

  return new ApiResponse(
    StatusCodes.OK,
    result,
    `Login alerts ${result.loginAlerts ? "enabled" : "disabled"}.`,
  ).send(res);
});

const authController = {
  registerUser,
  loginUser,
  refreshToken,
  logoutUser,
  checkAuth,
  forgotPassword,
  openAppResetPassword,
  resetPassword,
  changePassword,
  updateLoginAlerts,
};

export default authController;
