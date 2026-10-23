import jwt from "jsonwebtoken";
import User from "../models/users.model.js";
import Session from "../models/session.model.js";
import ApiError from "../utils/apiError.js";
import { StatusCodes } from "http-status-codes";
import { accessToken } from "../constants/constant.js";

const authMiddleware = async (req, res, next) => {
  try {
    const token =
      req.cookies?.accessToken ||
      req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      throw new ApiError(StatusCodes.UNAUTHORIZED, "Authentication required");
    }

    let decoded;
    try {
      decoded = jwt.verify(token, accessToken);
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new ApiError(StatusCodes.UNAUTHORIZED, "Invalid token");
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
          "Session has been revoked. Please sign in again.",
        );
      }
    }

    const user = await User.findById(decoded.id)
      .select("-password +tokenVersion")
      .lean();

    if (!user) {
      throw new ApiError(StatusCodes.NOT_FOUND, "User not found");
    }

    if (
      decoded.tokenVersion !== undefined &&
      user.tokenVersion !== undefined &&
      decoded.tokenVersion < user.tokenVersion
    ) {
      throw new ApiError(
        StatusCodes.UNAUTHORIZED,
        "Session invalidated. Please sign in again.",
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
