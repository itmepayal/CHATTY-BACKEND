import { StatusCodes } from "http-status-codes";
import * as userRepository from "../modules/users/repositories/user.repository.js";
import { verifyUnlockToken } from "../modules/users/utils/lock-token.util.js";
import { getOrFetchPrivacy } from "../infrastructure/socket/socket-state.js";

/**
 * Reusable middleware that checks whether the target conversation or group
 * is in the caller's lockedChats. If locked, requires a valid X-Chat-Unlock-Token.
 * Returns 423 Locked with { code: "CHAT_LOCKED" } on missing or invalid tokens.
 */
export const requireChatUnlocked = (chatIdParam = "id") => {
  return async (req, res, next) => {
    try {
      const targetChatId = String(
        req.params?.[chatIdParam] ||
        req.body?.[chatIdParam] ||
        req.query?.[chatIdParam] ||
        "",
      );

      if (!targetChatId) {
        return next();
      }

      const userId = req.user?._id || req.user?.id;
      if (!userId) {
        return next();
      }

      // Check caller's lockedChats from cached socket state or DB
      const privacy = await getOrFetchPrivacy(userId);
      const lockedChats = (privacy?.lockedChats || []).map(String);

      // If conversation is not locked by the caller, allow read access
      if (!lockedChats.includes(targetChatId)) {
        return next();
      }

      // Conversation is locked. Check X-Chat-Unlock-Token header
      const rawToken =
        req.header("X-Chat-Unlock-Token") ||
        req.header("x-chat-unlock-token") ||
        req.header("X-Unlock-Token") ||
        req.header("x-unlock-token") ||
        req.query?.unlockToken;

      if (!rawToken) {
        return res.status(StatusCodes.LOCKED).json({
          success: false,
          code: "CHAT_LOCKED",
          message: "Conversation is locked.",
        });
      }

      const decoded = verifyUnlockToken(rawToken);
      if (!decoded) {
        return res.status(StatusCodes.LOCKED).json({
          success: false,
          code: "CHAT_LOCKED",
          message: "Invalid or expired unlock token.",
        });
      }

      // Verify token subject matches current user
      if (String(decoded.userId) !== String(userId)) {
        return res.status(StatusCodes.LOCKED).json({
          success: false,
          code: "CHAT_LOCKED",
          message: "Unlock token does not belong to the current user.",
        });
      }

      // Verify scope: must be "app" or match targetChatId
      if (decoded.scope !== "app" && String(decoded.scope) !== targetChatId) {
        return res.status(StatusCodes.LOCKED).json({
          success: false,
          code: "CHAT_LOCKED",
          message: "Unlock token scope does not cover this conversation.",
        });
      }

      // Verify lockEpoch against user's current lockEpoch
      const userDoc = await userRepository.findById(userId).select("+lockEpoch");
      if (
        userDoc &&
        decoded.lockEpoch !== undefined &&
        decoded.lockEpoch < (userDoc.lockEpoch || 0)
      ) {
        return res.status(StatusCodes.LOCKED).json({
          success: false,
          code: "CHAT_LOCKED",
          message: "Unlock token has been invalidated.",
        });
      }

      // If token is bound to a sessionId and request has a sessionId, verify match
      if (decoded.sessionId && req.sessionId) {
        if (String(decoded.sessionId) !== String(req.sessionId)) {
          return res.status(StatusCodes.LOCKED).json({
            success: false,
            code: "CHAT_LOCKED",
            message: "Unlock token is not valid for this session.",
          });
        }
      }

      req.chatUnlocked = true;
      return next();
    } catch (err) {
      console.error("[requireChatUnlocked] error:", err?.message || err);
      return res.status(StatusCodes.LOCKED).json({
        success: false,
        code: "CHAT_LOCKED",
        message: "Failed to verify conversation lock status.",
      });
    }
  };
};

export default requireChatUnlocked;
