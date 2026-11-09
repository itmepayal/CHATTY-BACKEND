import { StatusCodes } from "http-status-codes";
import asyncHandler from "../middlewares/asyncHandler.middleware.js";
import ApiResponse from "../utils/api-response.js";
import {
  accessCookieOptions,
  refreshCookieOptions,
} from "../constants/auth.constants.js";
import * as authService from "../services/auth/auth.service.js";
import * as passwordService from "../services/auth/password.service.js";
import * as tokenService from "../services/auth/token.service.js";
import { extractRefreshToken } from "../services/auth/token.service.js";
import { buildAuthUserPayload } from "../helpers/auth-payload.helper.js";

const authController = {
  registerUser: asyncHandler(async (req, res) => {
    const { fullName, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.register({
      req,
      fullName,
      email: req.body.email,
      password,
      file: req.file,
    });

    res
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions);

    return new ApiResponse(
      StatusCodes.CREATED,
      buildAuthUserPayload(user, { accessToken, refreshToken }),
      "User registered successfully",
    ).send(res);
  }),

  loginUser: asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const result = await authService.login({ req, email, password });

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

    res
      .cookie("accessToken", result.accessToken, accessCookieOptions)
      .cookie("refreshToken", result.refreshToken, refreshCookieOptions);

    return new ApiResponse(
      StatusCodes.OK,
      buildAuthUserPayload(
        result.user,
        { accessToken: result.accessToken, refreshToken: result.refreshToken },
        { twoFactorEnabled: false, loginAlerts: result.user.loginAlerts },
      ),
      "User login successfully",
    ).send(res);
  }),

  refreshToken: asyncHandler(async (req, res) => {
    const token = extractRefreshToken(req);
    const tokens = await tokenService.rotateTokens(token);

    res
      .cookie("accessToken", tokens.accessToken, accessCookieOptions)
      .cookie("refreshToken", tokens.refreshToken, refreshCookieOptions);

    return new ApiResponse(
      StatusCodes.OK,
      { token: tokens },
      "Tokens refreshed successfully.",
    ).send(res);
  }),

  logoutUser: asyncHandler(async (req, res) => {
    const rawAccessToken =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");
    const rawRefreshToken = extractRefreshToken(req);

    const result = await authService.logout({
      accessToken: rawAccessToken,
      refreshToken: rawRefreshToken,
    });

    res
      .clearCookie("accessToken", accessCookieOptions)
      .clearCookie("refreshToken", refreshCookieOptions);

    return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
  }),

  checkAuth: asyncHandler(async (req, res) => {
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
  }),

  forgotPassword: asyncHandler(async (req, res) => {
    const { platform, email } = req.body;
    const result = await passwordService.requestPasswordReset({
      email,
      platform,
    });

    return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
  }),

  openAppResetPassword: asyncHandler(async (req, res) => {
    const { token } = req.params;
    const html = passwordService.getOpenAppResetHtml(token);

    res.set({
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    });

    return res.status(StatusCodes.OK).type("html").send(html);
  }),

  resetPassword: asyncHandler(async (req, res) => {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    const result = await passwordService.resetPassword({
      token,
      password,
      confirmPassword,
    });

    return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
  }),

  changePassword: asyncHandler(async (req, res) => {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    const result = await passwordService.changePassword({
      userId: req.user._id,
      currentSessionId: req.sessionId,
      currentPassword,
      newPassword,
      confirmPassword,
    });

    return new ApiResponse(StatusCodes.OK, null, result.message).send(res);
  }),

  updateLoginAlerts: asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    const result = await authService.updateLoginAlerts({
      userId: req.user._id,
      enabled,
    });

    return new ApiResponse(
      StatusCodes.OK,
      result,
      `Login alerts ${result.loginAlerts ? "enabled" : "disabled"}.`,
    ).send(res);
  }),
};

export default authController;
