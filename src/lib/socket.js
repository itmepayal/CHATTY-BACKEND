import express from "express";
import { Server } from "socket.io";
import http from "http";
import jwt from "jsonwebtoken";
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import User from "../models/users.model.js";
import Contact from "../models/contact.model.js";
import Session from "../models/session.model.js";
import {
  accessToken as accessTokenSecret,
  corsOriginValidator,
} from "../constants/constants.js";
import {
  BLOCK_CACHE_TTL_MS,
  SOCKET_THROTTLE_MS,
} from "../constants/constants.js";
import { registerCallHandlers } from "./callSignaling.js";
import { safeHandler } from "../utils/socket-safe.js";
import { socketLimiter } from "../utils/socket-rate-limit.js";
import { SOCKET_RATE_LIMITS } from "../constants/rate-limit.constants.js";
import {
  registerGroupCallHandlers,
  isUserInGroupCall,
} from "./groupCallSignaling.js";
import { registerLocationHandlers } from "./locationSharing.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: corsOriginValidator,
    credentials: true,
  },
});

export const groupRoom = (groupId) => `group:${groupId}`;

const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

const onlineUsers = new Map();

const DEFAULT_PRIVACY = {
  showOnlineStatus: true,
  onlineStatusVisibility: "everyone",
  readReceipts: true,
  typingIndicator: true,
  lastSeenVisibility: "contacts",
  profilePhotoVisibility: "everyone",
  aboutVisibility: "contacts",
  groupAddPermission: "contacts",
};

export const privacyByUser = new Map();

const cleanPrivacy = (p = {}) => {
  const onlineStatusVisibility =
    p.onlineStatusVisibility ??
    (p.showOnlineStatus === false ? "nobody" : "everyone");
  return {
    showOnlineStatus: onlineStatusVisibility !== "nobody",
    onlineStatusVisibility,
    readReceipts: p.readReceipts !== false,
    typingIndicator: p.typingIndicator !== false,
    lastSeenVisibility: p.lastSeenVisibility ?? "contacts",
    profilePhotoVisibility: p.profilePhotoVisibility ?? "everyone",
    aboutVisibility: p.aboutVisibility ?? "contacts",
    groupAddPermission: p.groupAddPermission ?? "contacts",
  };
};

export const getPrivacy = (userId) =>
  privacyByUser.get(String(userId)) || DEFAULT_PRIVACY;

export const loadPrivacy = async (userId) => {
  try {
    const u = await User.findById(userId)
      .select(
        "showOnlineStatus onlineStatusVisibility readReceipts typingIndicator lastSeenVisibility profilePhotoVisibility aboutVisibility groupAddPermission",
      )
      .lean();

    if (u) privacyByUser.set(String(userId), cleanPrivacy(u));
  } catch (e) {
    console.error("[socket] loadPrivacy failed:", e?.message || e);
  }
};

const blockCache = new Map();

const isBlockedEitherWay = async (a, b) => {
  const key = a < b ? `${a}:${b}` : `${b}:${a}`;
  const hit = blockCache.get(key);

  if (hit && hit.exp > Date.now()) return hit.value;

  let value = false;
  try {
    const found = await User.exists({
      $or: [
        { _id: a, blockedUsers: b },
        { _id: b, blockedUsers: a },
      ],
    });
    value = Boolean(found);
  } catch (e) {
    console.error("[socket] block check failed:", e?.message || e);
  }

  blockCache.set(key, { value, exp: Date.now() + BLOCK_CACHE_TTL_MS });

  if (blockCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of blockCache) if (v.exp <= now) blockCache.delete(k);
  }

  return value;
};

export const isUserOnline = (userId) =>
  (onlineUsers.get(userId.toString())?.size || 0) > 0;

export const isUserViewingChat = async (receiverId, senderId) => {
  const sockets = await io.in(receiverId.toString()).fetchSockets();

  return sockets.some((s) => s.data.activeChatId === senderId.toString());
};

export const disconnectUser = (userId) => {
  if (!userId) return;
  io.in(String(userId)).disconnectSockets(true);
};

export const disconnectUserSession = async (userId, sessionId) => {
  if (!userId || !sessionId) return;
  try {
    const sockets = await io.in(String(userId)).fetchSockets();
    for (const s of sockets) {
      if (s.data?.sessionId && String(s.data.sessionId) === String(sessionId)) {
        s.disconnect(true);
      }
    }
  } catch (err) {
    console.error("[socket] disconnectUserSession error:", err?.message || err);
  }
};

export const disconnectOtherUserSessions = async (userId, keepSessionId) => {
  if (!userId) return;
  try {
    const sockets = await io.in(String(userId)).fetchSockets();
    for (const s of sockets) {
      if (
        !keepSessionId ||
        (s.data?.sessionId &&
          String(s.data.sessionId) !== String(keepSessionId))
      ) {
        s.disconnect(true);
      }
    }
  } catch (err) {
    console.error(
      "[socket] disconnectOtherUserSessions error:",
      err?.message || err,
    );
  }
};

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((c) => {
        const i = c.indexOf("=");

        if (i < 0) return null;

        return [
          c.slice(0, i).trim(),
          decodeURIComponent(c.slice(i + 1).trim()),
        ];
      })
      .filter(Boolean),
  );

io.use(async (socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const authHeader = socket.handshake.headers.authorization;
    const token =
      cookies.accessToken ||
      socket.handshake.auth?.token ||
      (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : authHeader);

    if (!token) {
      console.log("[socket] rejected: no token");
      return next(new Error("Unauthorized"));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, accessTokenSecret);
    } catch (err) {
      console.log("[socket] rejected: invalid token:", err.message);
      return next(new Error("Unauthorized"));
    }

    if (decoded.sessionId) {
      const session = await Session.findById(decoded.sessionId)
        .select("revoked expiresAt userId")
        .lean();

      if (!session || session.revoked || session.expiresAt < new Date()) {
        console.log("[socket] rejected: session revoked or expired");
        return next(new Error("Unauthorized: Session revoked"));
      }

      if (String(session.userId) !== String(decoded.id)) {
        console.log("[socket] rejected: session owner mismatch");
        return next(new Error("Unauthorized: Invalid session"));
      }
    }

    const user = await User.findById(decoded.id)
      .select("fullName tokenVersion status")
      .lean();

    if (!user) {
      console.log("[socket] rejected: user not found");
      return next(new Error("Unauthorized: User not found"));
    }

    if (user.status === "suspended") {
      console.log("[socket] rejected: user account suspended");
      return next(new Error("Forbidden: Account suspended"));
    }

    if (decoded.tokenVersion === undefined) {
      console.log("[socket] rejected: missing token version");
      return next(new Error("Unauthorized: Invalid token"));
    }

    if (
      user.tokenVersion !== undefined &&
      decoded.tokenVersion < user.tokenVersion
    ) {
      console.log("[socket] rejected: token version invalidated");
      return next(new Error("Unauthorized: Token invalidated"));
    }

    socket.data.userId = String(decoded.id);
    socket.data.fullName = user.fullName || decoded.fullName;
    socket.data.sessionId = decoded.sessionId || null;

    next();
  } catch (err) {
    console.log("[socket] rejected:", err.message);
    next(new Error("Unauthorized"));
  }
});

async function markPendingAsDelivered(userId) {
  try {
    const pending = await Message.find({
      receiverId: userId,
      status: "sent",
      isDeleted: false,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).select("_id senderId");

    if (!pending.length) return;

    const now = new Date();
    const ids = pending.map((m) => m._id);

    await Message.updateMany(
      { _id: { $in: ids }, status: "sent" },
      { $set: { status: "delivered", deliveredAt: now } },
    );

    const bySender = {};

    for (const m of pending) {
      const sid = m.senderId.toString();
      (bySender[sid] ||= []).push(m._id);
    }

    for (const [senderId, messageIds] of Object.entries(bySender)) {
      io.to(senderId).emit("messagesDelivered", {
        messageIds,
        deliveredAt: now,
      });
    }
  } catch (error) {
    console.error("markPendingAsDelivered failed:", error?.message || error);
  }
}

export const getAuthorizedOnlineUsersForViewer = async (viewerId) => {
  const vId = String(viewerId);
  const activeIds = Array.from(onlineUsers.keys());
  if (!activeIds.length) return [];

  const candidates = [];
  const contactsCheckIds = [];

  for (const id of activeIds) {
    if (id === vId) {
      candidates.push(id);
      continue;
    }
    const priv = getPrivacy(id);
    const onlineVis =
      priv.showOnlineStatus === false
        ? "nobody"
        : (priv.onlineStatusVisibility ?? "everyone");

    if (onlineVis === "nobody") {
      continue;
    }
    if (onlineVis === "everyone") {
      candidates.push(id);
    } else if (onlineVis === "contacts") {
      contactsCheckIds.push(id);
    }
  }

  const allToCheck = [
    ...candidates.filter((id) => id !== vId),
    ...contactsCheckIds,
  ];
  if (!allToCheck.length) return candidates.filter((id) => id === vId);

  const [savedContacts, blockers, meDoc] = await Promise.all([
    contactsCheckIds.length
      ? Contact.find({ ownerId: { $in: contactsCheckIds }, contactId: vId })
          .select("ownerId")
          .lean()
      : Promise.resolve([]),
    User.find({ _id: { $in: allToCheck }, blockedUsers: vId })
      .select("_id")
      .lean(),
    User.findById(vId).select("blockedUsers").lean(),
  ]);

  const savedSet = new Set(savedContacts.map((c) => String(c.ownerId)));
  const blockedMe = new Set(blockers.map((b) => String(b._id)));
  const blockedByMe = new Set((meDoc?.blockedUsers || []).map(String));

  const authorized = [];
  for (const id of activeIds) {
    if (id === vId) {
      authorized.push(id);
      continue;
    }
    if (blockedMe.has(id) || blockedByMe.has(id)) {
      continue;
    }
    const priv = getPrivacy(id);
    const onlineVis =
      priv.showOnlineStatus === false
        ? "nobody"
        : (priv.onlineStatusVisibility ?? "everyone");

    if (onlineVis === "nobody") {
      continue;
    }
    if (onlineVis === "everyone") {
      authorized.push(id);
    } else if (onlineVis === "contacts" && savedSet.has(id)) {
      authorized.push(id);
    }
  }

  return authorized;
};

export const sendAuthorizedOnlineList = async (userId) => {
  try {
    const list = await getAuthorizedOnlineUsersForViewer(userId);
    io.to(String(userId)).emit("getOnlineUsers", { online: list, hidden: [] });
  } catch (err) {
    console.error(
      `[socket] sendAuthorizedOnlineList error for ${userId}:`,
      err?.message || err,
    );
  }
};

export const notifyUserPresenceChange = async (
  userId,
  isOnline,
  lastSeen = null,
) => {
  const uId = String(userId);
  const priv = getPrivacy(uId);

  io.to(uId).emit("presence:updated", {
    userId: uId,
    isOnline,
    lastSeen: isOnline ? null : lastSeen,
  });

  const onlineVis =
    priv.showOnlineStatus === false
      ? "nobody"
      : (priv.onlineStatusVisibility ?? "everyone");

  const targetVis = isOnline
    ? onlineVis
    : (priv.lastSeenVisibility ?? "contacts");
  if (targetVis === "nobody") {
    return;
  }

  const activeViewerIds = Array.from(onlineUsers.keys()).filter(
    (id) => id !== uId,
  );
  if (!activeViewerIds.length) return;

  let allowedViewerIds = [];
  if (targetVis === "contacts") {
    const contactsOfU = await Contact.find({
      ownerId: uId,
      contactId: { $in: activeViewerIds },
    })
      .select("contactId")
      .lean();
    allowedViewerIds = contactsOfU.map((c) => String(c.contactId));
  } else if (targetVis === "everyone") {
    allowedViewerIds = activeViewerIds;
  }

  if (!allowedViewerIds.length) return;

  const [blockers, uDoc] = await Promise.all([
    User.find({ _id: { $in: allowedViewerIds }, blockedUsers: uId })
      .select("_id")
      .lean(),
    User.findById(uId).select("blockedUsers").lean(),
  ]);
  const blockerSet = new Set(blockers.map((b) => String(b._id)));
  const myBlockedSet = new Set((uDoc?.blockedUsers || []).map(String));

  for (const viewerId of allowedViewerIds) {
    if (blockerSet.has(viewerId) || myBlockedSet.has(viewerId)) continue;
    io.to(viewerId).emit("presence:updated", {
      userId: uId,
      isOnline,
      lastSeen:
        isOnline || priv.lastSeenVisibility === "nobody" ? null : lastSeen,
    });
  }
};

export const broadcastOnline = async () => {
  for (const id of onlineUsers.keys()) {
    sendAuthorizedOnlineList(id);
  }
};

export const refreshPrivacy = async (userId) => {
  const uId = String(userId);
  await loadPrivacy(uId);
  const priv = getPrivacy(uId);

  io.to(uId).emit("privacy:settings-updated", priv);
  io.to(uId).emit("privacy:update", priv);
  io.emit("user:profile-updated", { userId: uId });

  const isOnline = (onlineUsers.get(uId)?.size || 0) > 0;
  const onlineVis =
    priv.showOnlineStatus === false
      ? "nobody"
      : (priv.onlineStatusVisibility ?? "everyone");

  const otherActiveViewers = Array.from(onlineUsers.keys()).filter(
    (id) => id !== uId,
  );

  if (isOnline && otherActiveViewers.length) {
    if (onlineVis === "nobody") {
      for (const vId of otherActiveViewers) {
        io.to(vId).emit("presence:updated", {
          userId: uId,
          isOnline: false,
          lastSeen: null,
        });
      }
    } else {
      let allowedViewerIds = otherActiveViewers;
      if (onlineVis === "contacts") {
        const contactsOfU = await Contact.find({
          ownerId: uId,
          contactId: { $in: otherActiveViewers },
        })
          .select("contactId")
          .lean();
        allowedViewerIds = contactsOfU.map((c) => String(c.contactId));
      }

      const [blockers, uDoc] = await Promise.all([
        User.find({ _id: { $in: otherActiveViewers }, blockedUsers: uId })
          .select("_id")
          .lean(),
        User.findById(uId).select("blockedUsers").lean(),
      ]);

      const blockerSet = new Set(blockers.map((b) => String(b._id)));
      const myBlockedSet = new Set((uDoc?.blockedUsers || []).map(String));
      const allowedSet = new Set(allowedViewerIds);

      for (const vId of otherActiveViewers) {
        const canSee =
          allowedSet.has(vId) && !blockerSet.has(vId) && !myBlockedSet.has(vId);

        io.to(vId).emit("presence:updated", {
          userId: uId,
          isOnline: canSee,
          lastSeen: null,
        });
      }
    }
  }

  // Immediately push fresh authorized online user list to ALL currently connected users
  for (const activeId of onlineUsers.keys()) {
    await sendAuthorizedOnlineList(activeId);
  }
};

io.on("connection", (socket) => {
  const userId = socket.data.userId;

  console.log("[socket] connected:", userId, socket.id);

  socket.join(userId);

  const isFirstConnection =
    !onlineUsers.has(userId) || onlineUsers.get(userId).size === 0;

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }

  onlineUsers.get(userId).add(socket.id);

  registerCallHandlers(io, socket, {
    isUserOnline,
    isBusy: isUserInGroupCall,
  });
  registerGroupCallHandlers(io, socket);
  registerLocationHandlers(io, socket, { isBlockedEitherWay });

  socket.data.typingTo = new Set();
  socket.data.typingGroups = new Set();

  const lastEmit = { typing: 0, groupTyping: 0 };
  const THROTTLE_MS = SOCKET_THROTTLE_MS;

  socket.on(
    "chat:open",
    safeHandler("chat:open", (otherUserId) => {
      socket.data.activeChatId = isObjectId(otherUserId) ? otherUserId : null;
    }),
  );

  socket.on(
    "chat:close",
    safeHandler("chat:close", () => {
      socket.data.activeChatId = null;
    }),
  );

  socket.on(
    "privacy:update",
    safeHandler("privacy:update", async () => {
      if (
        !socketLimiter.consume(
          userId,
          "privacy:update",
          SOCKET_RATE_LIMITS.PRIVACY_UPDATE,
        )
      ) {
        return;
      }
      await refreshPrivacy(userId);
    }),
  );

  socket.on(
    "typing",
    safeHandler("typing", async (payload) => {
      const to = payload?.to;

      if (!isObjectId(to) || to === userId) return;

      if (!socketLimiter.consume(userId, "typing", SOCKET_RATE_LIMITS.TYPING)) {
        return;
      }

      const isTyping = Boolean(payload.isTyping);

      if (isTyping) {
        const now = Date.now();

        if (now - lastEmit.typing < THROTTLE_MS) return;
        lastEmit.typing = now;

        if (!getPrivacy(userId).typingIndicator) return;

        if (await isBlockedEitherWay(userId, to)) return;

        socket.data.typingTo.add(to);
      } else {
        socket.data.typingTo.delete(to);
      }

      io.to(to).emit("typing", { from: userId, isTyping });
    }),
  );

  socket.on(
    "group:typing",
    safeHandler("group:typing", async (payload) => {
      const groupId = payload?.groupId;

      if (!isObjectId(groupId)) return;

      const room = groupRoom(groupId);

      if (!socket.rooms.has(room)) return;

      const isTyping = Boolean(payload.isTyping);

      if (isTyping) {
        const now = Date.now();

        if (now - lastEmit.groupTyping < THROTTLE_MS) return;
        lastEmit.groupTyping = now;

        if (!getPrivacy(userId).typingIndicator) return;

        socket.data.typingGroups.add(groupId);
      } else {
        socket.data.typingGroups.delete(groupId);
      }

      try {
        const group = await Group.findById(groupId)
          .select("members.userId")
          .lean();
        if (!group) return;

        const memberIds = group.members
          .map((m) => String(m.userId))
          .filter((id) => id !== userId);

        if (!memberIds.length) return;

        const [blockers, meDoc] = await Promise.all([
          User.find({ _id: { $in: memberIds }, blockedUsers: userId })
            .select("_id")
            .lean(),
          User.findById(userId).select("blockedUsers").lean(),
        ]);

        const blockerSet = new Set(blockers.map((b) => String(b._id)));
        const myBlockedSet = new Set((meDoc?.blockedUsers || []).map(String));

        const typingPayload = {
          groupId,
          userId,
          fullName: socket.data.fullName,
          isTyping,
        };

        for (const mId of memberIds) {
          if (!blockerSet.has(mId) && !myBlockedSet.has(mId)) {
            io.to(mId).emit("group:typing", typingPayload);
          }
        }
      } catch (e) {
        console.error("[socket] group:typing failed:", e?.message || e);
      }
    }),
  );

  socket.on(
    "disconnect",
    safeHandler("disconnect", async () => {
      socket.data.typingTo?.forEach((to) =>
        io.to(to).emit("typing", {
          from: userId,
          isTyping: false,
        }),
      );

      if (socket.data.typingGroups?.size) {
        const groupIds = Array.from(socket.data.typingGroups);
        for (const groupId of groupIds) {
          try {
            const group = await Group.findById(groupId)
              .select("members.userId")
              .lean();
            if (!group) continue;

            const memberIds = group.members
              .map((m) => String(m.userId))
              .filter((id) => id !== userId);

            if (!memberIds.length) continue;

            const [blockers, meDoc] = await Promise.all([
              User.find({ _id: { $in: memberIds }, blockedUsers: userId })
                .select("_id")
                .lean(),
              User.findById(userId).select("blockedUsers").lean(),
            ]);

            const blockerSet = new Set(blockers.map((b) => String(b._id)));
            const myBlockedSet = new Set(
              (meDoc?.blockedUsers || []).map(String),
            );

            const typingPayload = {
              groupId,
              userId,
              fullName: socket.data.fullName,
              isTyping: false,
            };

            for (const mId of memberIds) {
              if (!blockerSet.has(mId) && !myBlockedSet.has(mId)) {
                io.to(mId).emit("group:typing", typingPayload);
              }
            }
          } catch {}
        }
      }

      const set = onlineUsers.get(userId);

      if (set) {
        set.delete(socket.id);

        if (set.size === 0) {
          onlineUsers.delete(userId);
          privacyByUser.delete(userId);

          const lastSeen = new Date();
          User.findByIdAndUpdate(userId, {
            lastSeen,
          }).catch(() => {});
          await notifyUserPresenceChange(userId, false, lastSeen);
        }
      }
    }),
  );

  (async () => {
    try {
      await loadPrivacy(userId);

      try {
        const groups = await Group.find({
          "members.userId": userId,
        })
          .select("_id")
          .lean();

        groups.forEach((g) => socket.join(groupRoom(g._id)));
      } catch (e) {
        console.error("join group rooms failed:", e?.message || e);
      }

      if (!socket.connected) return;

      if (isFirstConnection) {
        await notifyUserPresenceChange(userId, true);
      }
      await sendAuthorizedOnlineList(userId);
      markPendingAsDelivered(userId);
    } catch (err) {
      console.error("[socket] Connection setup error:", err?.message || err);
    }
  })();
});

export { app, server, io };
