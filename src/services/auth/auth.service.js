import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../utils/api-error.js";
import User from "../../models/users.model.js";
import Session from "../../models/session.model.js";
import {
  uploadFileToCloudinary,
  deleteFileToCloudinary,
} from "../../config/cloudinary.config.js";
import { signChallengeToken } from "../../utils/totp.js";
import { createLoginSession } from "./session.service.js";
import {
  accessToken as accessTokenSecret,
  refreshTokenSecret,
  AUTH_MESSAGES,
} from "../../constants/auth.constants.js";
import {
  normalizeEmail,
  validateRegisterInput,
  validateLoginInput,
  validateLoginAlertsInput,
} from "../../validators/auth.validator.js";
import { io, disconnectUser, disconnectUserSession } from "../../lib/socket.js";

export const register = async ({ req, fullName, email, password, file }) => {
  const normalisedEmail = normalizeEmail(email);
  validateRegisterInput({
    fullName,
    email: normalisedEmail,
    password,
    file,
  });

  const userExists = await User.findOne({ email: normalisedEmail });
  if (userExists) {
    throw new ApiError(StatusCodes.CONFLICT, "Email already registered.");
  }

  const avatar = await uploadFileToCloudinary(file.path);
  if (!avatar?.public_id || !avatar.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload avatar.");
  }

  let user;
  let sessionResult;

  try {
    user = await User.create({
      fullName: fullName.trim(),
      email: normalisedEmail,
      password,
      avatar: {
        public_id: avatar.public_id,
        url: avatar.secure_url,
      },
    });

    sessionResult = await createLoginSession(req, user);
  } catch (err) {
    if (avatar?.public_id) {
      await deleteFileToCloudinary(avatar.public_id, "image").catch(() => {});
    }

    if (err?.code === 11000) {
      throw new ApiError(StatusCodes.CONFLICT, "Email already registered.");
    }
    throw err;
  }

  return {
    user,
    accessToken: sessionResult.accessToken,
    refreshToken: sessionResult.refreshToken,
  };
};

export const login = async ({ req, email, password }) => {
  const normalisedEmail = normalizeEmail(email);
  validateLoginInput({ email: normalisedEmail, password });

  const user = await User.findOne({ email: normalisedEmail }).select(
    "+password +twoFactorSecret +twoFactorEnabled +loginAlerts",
  );

  const INVALID_CREDENTIALS = AUTH_MESSAGES.INVALID_CREDENTIALS;

  if (!user) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, INVALID_CREDENTIALS);
  }

  const isMatch = await user.isPassword(password);
  if (!isMatch) {
    throw new ApiError(StatusCodes.UNAUTHORIZED, INVALID_CREDENTIALS);
  }

  if (user.status === "suspended") {
    throw new ApiError(StatusCodes.FORBIDDEN, AUTH_MESSAGES.ACCOUNT_SUSPENDED);
  }

  if (user.twoFactorEnabled) {
    const challengeToken = signChallengeToken(user);
    return {
      twoFactorRequired: true,
      challengeToken,
    };
  }

  const { accessToken, refreshToken } = await createLoginSession(req, user);

  return {
    twoFactorRequired: false,
    user,
    accessToken,
    refreshToken,
  };
};

export const logout = async ({
  accessToken: rawAccessToken,
  refreshToken: rawRefreshToken,
}) => {
  let targetSessionId = null;
  let userId = null;

  if (rawAccessToken) {
    try {
      const decoded = jwt.verify(rawAccessToken, accessTokenSecret);
      targetSessionId = decoded.sessionId || null;
      userId = decoded.id;
    } catch {}
  }

  if (!targetSessionId && rawRefreshToken) {
    try {
      const decodedRefresh = jwt.verify(rawRefreshToken, refreshTokenSecret);
      targetSessionId = decodedRefresh.sessionId || null;
      userId = userId || decodedRefresh.id;
    } catch {}
  }

  if (!targetSessionId && rawAccessToken) {
    try {
      const decodedAny = jwt.decode(rawAccessToken);
      if (decodedAny?.sessionId) {
        targetSessionId = decodedAny.sessionId;
        userId = userId || decodedAny.id;
      }
    } catch {}
  }

  if (targetSessionId) {
    await Session.findByIdAndUpdate(targetSessionId, { revoked: true }).catch(
      () => {},
    );
    if (userId) {
      io.to(String(userId)).emit("session:revoked", {
        sessionId: targetSessionId,
      });
      await disconnectUserSession(userId, targetSessionId);
    }
  } else if (userId) {
    await Session.updateMany({ userId }, { $set: { revoked: true } }).catch(
      () => {},
    );
    await disconnectUser(userId);
  }

  return { message: AUTH_MESSAGES.LOGOUT_SUCCESS };
};

export const getAuthenticatedUser = (user) => {
  if (!user) {
    throw new ApiError(
      StatusCodes.UNAUTHORIZED,
      AUTH_MESSAGES.NOT_AUTHENTICATED,
    );
  }

  if (user.status === "suspended") {
    throw new ApiError(StatusCodes.FORBIDDEN, AUTH_MESSAGES.ACCOUNT_SUSPENDED);
  }

  return user;
};

export const updateLoginAlerts = async ({ userId, enabled }) => {
  validateLoginAlertsInput(enabled);

  await User.findByIdAndUpdate(userId, { loginAlerts: enabled });

  return { loginAlerts: enabled };
};
