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
} from "../constants/constant.js";

import { registerCallHandlers } from "./callSignaling.js";
import {
  registerGroupCallHandlers,
  isUserInGroupCall,
} from "./groupCallSignaling.js";
import { registerLocationHandlers } from "./locationSharing.js";

/* ---------- SERVER AND HTTP INITIALIZATION ---------- */
const app = express();
const server = http.createServer(app);

/* ---------- SOCKET.IO INITIALIZATION AND CORS ---------- */
const io = new Server(server, {
  cors: {
    origin: clientUrl,
    credentials: true,
  },
});

/* ---------- GROUP ROOM HELPER ---------- */
export const groupRoom = (groupId) => `group:${groupId}`;

/* ---------- ID VALIDATION (blocks fake rooms like "group:xyz" / socket ids) ---------- */
const isObjectId = (v) => typeof v === "string" && /^[a-f\d]{24}$/i.test(v);

/* ---------- ONLINE USERS TRACKING ---------- */
const onlineUsers = new Map();

/* ---------- PRIVACY DEFAULTS ---------- */
const DEFAULT_PRIVACY = {
  showOnlineStatus: true,
  readReceipts: true,
  typingIndicator: true,
};

/* ---------- USER PRIVACY CACHE ---------- */
export const privacyByUser = new Map();

/* ---------- PRIVACY NORMALIZATION ---------- */
const cleanPrivacy = (p = {}) => ({
  showOnlineStatus: p.showOnlineStatus !== false,
  readReceipts: p.readReceipts !== false,
  typingIndicator: p.typingIndicator !== false,
});

/* ---------- GET USER PRIVACY ---------- */
export const getPrivacy = (userId) =>
  privacyByUser.get(String(userId)) || DEFAULT_PRIVACY;

/* ---------- LOAD PRIVACY FROM DATABASE ---------- */
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

/* ---------- BLOCK CHECK FOR TYPING (short TTL cache, DB spam se bachne ke liye) ---------- */
const BLOCK_CACHE_TTL_MS = 10_000;
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

  // cache chhota rakhne ke liye purani entries saaf karo
  if (blockCache.size > 5000) {
    const now = Date.now();
    for (const [k, v] of blockCache) if (v.exp <= now) blockCache.delete(k);
  }

  return value;
};

/* ---------- ONLINE STATUS AND ACTIVE CHAT HELPERS ---------- */
export const isUserOnline = (userId) =>
  (onlineUsers.get(userId.toString())?.size || 0) > 0;

export const isUserViewingChat = async (receiverId, senderId) => {
  const sockets = await io.in(receiverId.toString()).fetchSockets();

  return sockets.some((s) => s.data.activeChatId === senderId.toString());
};

/* ---------- FORCE DISCONNECT (logout / session revoke ke time call karo) ---------- */
export const disconnectUser = (userId) =>
  io.in(String(userId)).disconnectSockets(true);

/* ---------- COOKIE PARSING ---------- */
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

/* ---------- SOCKET AUTHENTICATION MIDDLEWARE ---------- */
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

/* ---------- PENDING MESSAGE DELIVERY ---------- */
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

/* ---------- BROADCAST ONLINE USERS ---------- */
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

/* ---------- REFRESH USER PRIVACY ---------- */
export const refreshPrivacy = async (userId) => {
  await loadPrivacy(userId);
  broadcastOnline();
};

/* ---------- SOCKET CONNECTION HANDLER ---------- */
io.on("connection", (socket) => {
  const userId = socket.data.userId;

  console.log("[socket] connected:", userId, socket.id);

  /* ---------- REGISTER SOCKET AND TRACK PRESENCE ---------- */
  /* NOTE: user-room (userId) join hone se "chatArchived" jaise events
     owner ke saare tabs/devices tak apne aap pahunch jaate hain. */
  socket.join(userId);

  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }

  onlineUsers.get(userId).add(socket.id);

  /* ---------- REGISTER CALL SIGNALING ---------- */
  registerCallHandlers(io, socket, {
    isUserOnline,
    isBusy: isUserInGroupCall,
  });
  registerGroupCallHandlers(io, socket);
  registerLocationHandlers(io, socket, { isBlockedEitherWay });

  /* ---------- INITIALIZE TYPING TRACKING ---------- */
  socket.data.typingTo = new Set();
  socket.data.typingGroups = new Set();

  /* ---------- SOCKET EVENT THROTTLE ---------- */
  const lastEmit = { typing: 0, groupTyping: 0 };
  const THROTTLE_MS = 400;

  /* ---------- CHAT OPEN AND CLOSE EVENTS ---------- */
  socket.on("chat:open", (otherUserId) => {
    socket.data.activeChatId = isObjectId(otherUserId) ? otherUserId : null;
  });

  socket.on("chat:close", () => {
    socket.data.activeChatId = null;
  });

  /* ---------- PRIVACY UPDATE EVENT ---------- */
  socket.on("privacy:update", async () => {
    await refreshPrivacy(userId);
  });

  /* ---------- ONE-TO-ONE TYPING EVENTS ---------- */
  socket.on("typing", async (payload) => {
    const to = payload?.to;

    // sirf valid user id; room names / socket ids / khud ko reject
    if (!isObjectId(to) || to === userId) return;

    const isTyping = Boolean(payload.isTyping);

    // sirf "typing start" ko throttle karo, "stop" hamesha jaane do
    if (isTyping) {
      const now = Date.now();

      if (now - lastEmit.typing < THROTTLE_MS) return;
      lastEmit.typing = now;

      if (!getPrivacy(userId).typingIndicator) return;

      // block hone par typing nahi dikhni chahiye
      if (await isBlockedEitherWay(userId, to)) return;

      socket.data.typingTo.add(to);
    } else {
      socket.data.typingTo.delete(to);
    }

    io.to(to).emit("typing", { from: userId, isTyping });
  });

  /* ---------- GROUP TYPING EVENTS ---------- */
  socket.on("group:typing", (payload) => {
    const groupId = payload?.groupId;

    if (!isObjectId(groupId)) return;

    const room = groupRoom(groupId);

    if (!socket.rooms.has(room)) return;

    const isTyping = Boolean(payload.isTyping);

    // sirf "typing start" ko throttle karo, "stop" hamesha jaane do
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

  /* ---------- DISCONNECT AND TYPING CLEANUP ---------- */
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

    /* ---------- UPDATE ONLINE USERS TRACKING ---------- */
    const set = onlineUsers.get(userId);

    if (set) {
      set.delete(socket.id);

      if (set.size === 0) {
        onlineUsers.delete(userId);

        /* ---------- UPDATE LAST-SEEN INFORMATION ---------- */
        if (getPrivacy(userId).showOnlineStatus) {
          User.findByIdAndUpdate(userId, {
            lastSeen: new Date(),
          }).catch(() => {});
        }
      }
    }

    /* ---------- BROADCAST UPDATED PRESENCE ---------- */
    broadcastOnline();
  });

  /* ---------- LOAD PRIVACY AND JOIN GROUP ROOMS ---------- */
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

    /* ---------- VERIFY CONNECTION AND INITIALIZE DELIVERY ---------- */
    if (!socket.connected) return;

    broadcastOnline();
    markPendingAsDelivered(userId);
  })();
});

/* ---------- SERVER EXPORTS ---------- */
export { app, server, io };
