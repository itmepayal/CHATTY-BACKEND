import jwt from "jsonwebtoken";
import { StatusCodes } from "http-status-codes";
import ApiError from "../../../shared/errors/api-error.js";
import * as userRepository from "../../users/repositories/user.repository.js";
import * as sessionRepository from "../repositories/session.repository.js";
import {
  uploadFileToCloudinary,
  deleteFileToCloudinary,
} from "../../../config/cloudinary.config.js";
import { signChallengeToken } from "../helpers/totp.js";
import { createLoginSession } from "./session.service.js";
import {
  accessToken as accessTokenSecret,
  refreshTokenSecret,
  AUTH_MESSAGES,
} from "../constants/auth.constants.js";
import {
  normalizeEmail,
  normalizeUsername,
  validateRegisterInput,
  validateLoginInput,
  validateLoginAlertsInput,
} from "../validations/auth.validation.js";
import {
  io,
  disconnectUser,
  disconnectUserSession,
} from "../../../infrastructure/socket/socket.js";

export const register = async ({
  fullName,
  username,
  email,
  password,
  file,
  userAgent,
  ip,
}) => {
  const normalisedEmail = normalizeEmail(email);
  const normalisedUsername = normalizeUsername(username);

  validateRegisterInput({
    fullName,
    username: normalisedUsername,
    email: normalisedEmail,
    password,
    file,
  });

  const userExists = await userRepository.findByEmail(normalisedEmail);
  if (userExists) {
    throw new ApiError(StatusCodes.CONFLICT, "Email already registered.");
  }

  const usernameTaken = await userRepository.findByUsername(normalisedUsername);
  if (usernameTaken) {
    throw new ApiError(StatusCodes.CONFLICT, "Username already taken.");
  }

  const avatar = await uploadFileToCloudinary(file.path);
  if (!avatar?.public_id || !avatar.secure_url) {
    throw new ApiError(StatusCodes.BAD_REQUEST, "Failed to upload avatar.");
  }

  let user;
  let sessionResult;

  try {
    user = await userRepository.createUser({
      fullName: fullName.trim(),
      username: normalisedUsername,
      email: normalisedEmail,
      password,
      avatar: {
        public_id: avatar.public_id,
        url: avatar.secure_url,
      },
    });

    sessionResult = await createLoginSession(user, { userAgent, ip });
  } catch (err) {
    if (avatar?.public_id) {
      await deleteFileToCloudinary(avatar.public_id, "image").catch(() => {});
    }

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
      throw new ApiError(
        StatusCodes.CONFLICT,
        field === "username"
          ? "Username already taken."
          : "Email already registered.",
      );
    }
    throw err;
  }

  return {
    user,
    accessToken: sessionResult.accessToken,
    refreshToken: sessionResult.refreshToken,
  };
};

export const login = async ({ email, password, userAgent, ip }) => {
  const normalisedEmail = normalizeEmail(email);
  validateLoginInput({ email: normalisedEmail, password });

  const user =
    await userRepository.findByEmailWithLoginSecrets(normalisedEmail);

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

  const { accessToken, refreshToken } = await createLoginSession(user, {
    userAgent,
    ip,
  });

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
    await sessionRepository.revokeById(targetSessionId).catch(() => {});
    if (userId) {
      io.to(String(userId)).emit("session:revoked", {
        sessionId: targetSessionId,
      });
      await disconnectUserSession(userId, targetSessionId);
    }
  } else if (userId) {
    await sessionRepository.revokeAllForUser(userId).catch(() => {});
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

export const getAuthSession = async (user) => {
  const safeUser = getAuthenticatedUser(user);

  const tf = await userRepository.findByEmailWithLoginSecrets(safeUser._id);

  const extras = {
    status: safeUser.status || "active",
    twoFactorEnabled: tf?.twoFactorEnabled ?? false,
    loginAlerts: tf?.loginAlerts ?? true,
    twoFactor: {
      enabled: tf?.twoFactorEnabled ?? false,
      setupPending: tf?.twoFactorSetupPending ?? false,
      recoveryCodesRemaining: tf?.recoveryCodesRemaining ?? 0,
    },
  };

  return { user: safeUser, extras };
};

export const updateLoginAlerts = async ({ userId, enabled }) => {
  validateLoginAlertsInput(enabled);

  await userRepository.findByIdAndUpdate(userId, { loginAlerts: enabled });

  return { loginAlerts: enabled };
};

const authService = {
  register,
  login,
  logout,
  getAuthenticatedUser,
  updateLoginAlerts,
  getAuthSession,
};

export default authService;
