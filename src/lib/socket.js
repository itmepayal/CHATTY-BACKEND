import express from "express";
import { Server } from "socket.io";
import http from "http";
import jwt from "jsonwebtoken";
import Message from "../models/message.model.js";
import Group from "../models/group.model.js";
import User from "../models/users.model.js";
import {
  accessToken as accessTokenSecret,
  clientUrl,
} from "../constants/constants.js";
import {
  BLOCK_CACHE_TTL_MS,
  SOCKET_THROTTLE_MS,
} from "../constants/constants.js";
import { registerCallHandlers } from "./callSignaling.js";
import {
  registerGroupCallHandlers,
  isUserInGroupCall,
} from "./groupCallSignaling.js";
import { registerLocationHandlers } from "./locationSharing.js";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: clientUrl,
    credentials: true,
  },
});

export const groupRoom = (groupId) => `group:${groupId}`;

const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

const onlineUsers = new Map();

const DEFAULT_PRIVACY = {
  showOnlineStatus: true,
  readReceipts: true,
  typingIndicator: true,
};

export const privacyByUser = new Map();

const cleanPrivacy = (p = {}) => ({
  showOnlineStatus: p.showOnlineStatus !== false,
  readReceipts: p.readReceipts !== false,
  typingIndicator: p.typingIndicator !== false,
});

export const getPrivacy = (userId) =>
  privacyByUser.get(String(userId)) || DEFAULT_PRIVACY;

export const loadPrivacy = async (userId) => {
  try {
    const u = await User.findById(userId)
      .select("showOnlineStatus readReceipts typingIndicator")
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

export const disconnectUser = (userId) =>
  io.in(String(userId)).disconnectSockets(true);

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

io.use((socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = cookies.accessToken || socket.handshake.auth?.token;

    if (!token) {
      console.log("[socket] rejected: no token (cookie not sent?)");
      return next(new Error("Unauthorized"));
    }

    const decoded = jwt.verify(token, accessTokenSecret);

    socket.data.userId = String(decoded.id);
    socket.data.fullName = decoded.fullName;
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

export const broadcastOnline = () => {
  const online = [];
  const hidden = [];

  for (const id of onlineUsers.keys()) {
    if (getPrivacy(id).showOnlineStatus) {
      online.push(id);
    } else {
      hidden.push(id);
    }
  }

  io.emit("getOnlineUsers", { online, hidden });
};

export const refreshPrivacy = async (userId) => {
  await loadPrivacy(userId);
  broadcastOnline();
};

io.on("connection", (socket) => {
  const userId = socket.data.userId;

  console.log("[socket] connected:", userId, socket.id);

  socket.join(userId);

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

  socket.on("chat:open", (otherUserId) => {
    socket.data.activeChatId = isObjectId(otherUserId) ? otherUserId : null;
  });

  socket.on("chat:close", () => {
    socket.data.activeChatId = null;
  });

  socket.on("privacy:update", async () => {
    await refreshPrivacy(userId);
  });

  socket.on("typing", async (payload) => {
    const to = payload?.to;

    if (!isObjectId(to) || to === userId) return;

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
  });

  socket.on("group:typing", (payload) => {
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

    socket.to(room).emit("group:typing", {
      groupId,
      userId,
      fullName: socket.data.fullName,
      isTyping,
    });
  });

  socket.on("disconnect", () => {
    socket.data.typingTo?.forEach((to) =>
      io.to(to).emit("typing", {
        from: userId,
        isTyping: false,
      }),
    );

    socket.data.typingGroups?.forEach((groupId) =>
      socket.to(groupRoom(groupId)).emit("group:typing", {
        groupId,
        userId,
        fullName: socket.data.fullName,
        isTyping: false,
      }),
    );

    const set = onlineUsers.get(userId);

    if (set) {
      set.delete(socket.id);

      if (set.size === 0) {
        onlineUsers.delete(userId);

        if (getPrivacy(userId).showOnlineStatus) {
          User.findByIdAndUpdate(userId, {
            lastSeen: new Date(),
          }).catch(() => { });
        }
      }
    }

    broadcastOnline();
  });

  (async () => {
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

    broadcastOnline();
    markPendingAsDelivered(userId);
  })();
});

export { app, server, io };
