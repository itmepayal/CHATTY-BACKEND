import request from "supertest";
import bcrypt from "bcryptjs";
import { io as ioClient } from "socket.io-client";
import User from "../src/models/users.model.js";

export const TEST_PASSWORD = "Password123!";

export async function createAndLoginUsers(app, port) {
  await User.deleteMany({});

  const userConfigs = [
    {
      fullName: "Alice A",
      email: "alice@test.com",
      password: TEST_PASSWORD,
      publicKey: { n: "test_rsa_key_alice", e: "AQAB" },
      publicKeyUpdatedAt: new Date(),
      status: "active",
      readReceipts: true,
      typingIndicator: true,
      loginAlerts: false,
    },
    {
      fullName: "Bob B",
      email: "bob@test.com",
      password: TEST_PASSWORD,
      publicKey: { n: "test_rsa_key_bob", e: "AQAB" },
      publicKeyUpdatedAt: new Date(),
      status: "active",
      readReceipts: true,
      typingIndicator: true,
      loginAlerts: false,
    },
    {
      fullName: "Charlie C",
      email: "charlie@test.com",
      password: TEST_PASSWORD,
      publicKey: { n: "test_rsa_key_charlie", e: "AQAB" },
      publicKeyUpdatedAt: new Date(),
      status: "active",
      readReceipts: true,
      typingIndicator: true,
      loginAlerts: false,
    },
    {
      fullName: "David Blocked",
      email: "david@test.com",
      password: TEST_PASSWORD,
      status: "active",
      loginAlerts: false,
    },
    {
      fullName: "Eve Suspended",
      email: "eve@test.com",
      password: TEST_PASSWORD,
      status: "suspended",
      loginAlerts: false,
    },
  ];

  const createdUsers = await User.create(userConfigs);
  const userMap = {};
  for (const u of createdUsers) {
    userMap[u.email] = u;
  }

  // Set Alice to block David
  await User.updateOne(
    { _id: userMap["alice@test.com"]._id },
    { $set: { blockedUsers: [userMap["david@test.com"]._id] } },
  );

  const sessions = {};

  // Log in Alice, Bob, Charlie, David
  for (const email of [
    "alice@test.com",
    "bob@test.com",
    "charlie@test.com",
    "david@test.com",
  ]) {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email, password: TEST_PASSWORD });

    const cookieHeader = res.headers["set-cookie"] || [];
    const cookies = cookieHeader.map((c) => c.split(";")[0]).join("; ");
    const accessToken = cookieHeader
      .find((c) => c.startsWith("accessToken="))
      ?.split(";")[0]
      ?.split("=")[1];

    const userDoc = await User.findOne({ email });

    // Connect socket for active users
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      auth: { token: accessToken },
      extraHeaders: { Cookie: cookies },
      transports: ["websocket"],
      reconnection: false,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`Socket connection timeout for ${email}`)),
        4000,
      );
      socket.on("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.on("connect_error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    sessions[email] = {
      user: userDoc,
      cookies,
      accessToken,
      socket,
    };
  }

  // Suspended user Eve
  const eveDoc = userMap["eve@test.com"];
  sessions["eve@test.com"] = {
    user: eveDoc,
    cookies: null,
    accessToken: null,
    socket: null,
  };

  return {
    alice: sessions["alice@test.com"],
    bob: sessions["bob@test.com"],
    charlie: sessions["charlie@test.com"],
    david: sessions["david@test.com"],
    eve: sessions["eve@test.com"],
    allSessions: sessions,
  };
}
