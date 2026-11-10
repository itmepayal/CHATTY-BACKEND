import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import * as userRepository from "../../repositories/users/user.repository.js";
import * as sessionRepository from "../../repositories/auth/session.repository.js";
import {
  refreshTokenSecret,
  AUTH_MESSAGES,
} from "../../constants/auth/auth.constants.js";

export const extractRefreshToken = (req) =>
  req.cookies?.refreshToken ||
  req.body?.refreshToken ||
  req.header("X-Refresh-Token") ||
  req.header("x-refresh-token") ||
  null;

export const rotateTokens = async (token) => {
  if (!token) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, "Refresh token is required.");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, refreshTokenSecret);
  } catch (err) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      "Invalid or expired refresh token. Please sign in again.",
    );
  }

  if (decoded.sessionId) {
    const session = await sessionRepository.findById(decoded.sessionId);

    if (!session || session.revoked || session.expiresAt < new Date()) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        AUTH_MESSAGES.SESSION_REVOKED_OR_EXPIRED,
      );
    }

    if (String(session.userId) !== String(decoded.id)) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        AUTH_MESSAGES.INVALID_SESSION_OWNER,
      );
    }

    const user = await userRepository.findById(decoded.id).select("+tokenVersion");
    if (!user) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        AUTH_MESSAGES.USER_NOT_FOUND,
      );
    }

    if (user.status === "suspended") {
      throw new ApiError(
        StatusCodes.FORBIDDEN,
        AUTH_MESSAGES.ACCOUNT_SUSPENDED,
      );
    }

    if (
      decoded.tokenVersion !== undefined &&
      user.tokenVersion !== undefined &&
      decoded.tokenVersion < user.tokenVersion
    ) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        AUTH_MESSAGES.SESSION_INVALIDATED,
      );
    }

    session.lastActivity = new Date();
    await session.save();

    const currentSessionId = session._id;
    const tokenVer = user.tokenVersion ?? 0;
    const newAccessToken = user.generateAccessToken(currentSessionId, tokenVer);
    const newRefreshToken = user.generateRefreshToken(
      currentSessionId,
      tokenVer,
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  const user = await userRepository.findById(decoded.id).select("+tokenVersion");
  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, AUTH_MESSAGES.USER_NOT_FOUND);
  }

  if (user.status === "suspended") {
    throw new ApiError(StatusCodes.FORBIDDEN, AUTH_MESSAGES.ACCOUNT_SUSPENDED);
  }

  const tokenVer = user.tokenVersion ?? 0;
  const newAccessToken = user.generateAccessToken(null, tokenVer);
  const newRefreshToken = user.generateRefreshToken(null, tokenVer);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
};

const tokenService = {
  extractRefreshToken,
  rotateTokens,
};

export default tokenService;

