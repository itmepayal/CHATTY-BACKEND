import jwt from "jsonwebtoken";
import User from "../modules/users/models/users.model.js";
import Session from "../modules/auth/models/session.model.js";
import ApiError from "../shared/errors/api-error.js";
import { StatusCodes } from "http-status-codes";
import { accessToken, AUTH_MESSAGES } from "../modules/auth/constants/auth.constants.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, AUTH_MESSAGES.AUTH_REQUIRED);
    }

    let decoded;
    try {
      decoded = jwt.verify(token, accessToken);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          AUTH_MESSAGES.INVALID_TOKEN,
        );
      }
      throw error;
    }

    if (decoded.sessionId) {
      const session = await Session.findById(decoded.sessionId)
        .select("revoked expiresAt userId")
        .lean();

      if (!session || session.revoked || session.expiresAt < new Date()) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          AUTH_MESSAGES.SESSION_REVOKED,
        );
      }

      if (String(session.userId) !== String(decoded.id)) {
        throw new ApiError(
          StatusCodes.UNAUTHORIZED,
          AUTH_MESSAGES.INVALID_SESSION,
        );
      }

      Session.updateOne(
        {
          _id: decoded.sessionId,
          lastActivity: { $lt: new Date(Date.now() - 5 * 60 * 1000) },
        },
        { $set: { lastActivity: new Date() } },
      ).catch(() => {});
    }

    const user = await User.findById(decoded.id)
      .select("-password +tokenVersion")
      .lean();

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

    if (decoded.tokenVersion === undefined) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        AUTH_MESSAGES.INVALID_TOKEN_FORMAT,
      );
    }

    if (
      user.tokenVersion !== undefined &&
      decoded.tokenVersion < user.tokenVersion
    ) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        AUTH_MESSAGES.SESSION_INVALIDATED,
      );
    }

    const { tokenVersion: _tv, ...safeUser } = user;

    req.sessionId = decoded.sessionId || null;
    req.user = safeUser;
    next();
  } catch (error) {
    next(error);
  }
};

export default authMiddleware;
