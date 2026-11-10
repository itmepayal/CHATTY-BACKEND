import "../src/config/env.config.js";
import { spawn } from "child_process";
import fs from "fs";
import net from "net";
import path from "path";
import crypto from "crypto";
import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";

let mongodProcess = null;
let mongoDbPath = null;
let mongoPort = null;
let serverInstance = null;
let serverPort = null;
let ioInstance = null;
let appInstance = null;

export const uploadedAssets = [];
export const deletedAssets = [];

// Stub Cloudinary methods so nothing ever touches the network
export function setupCloudinaryMocks() {
  uploadedAssets.length = 0;
  deletedAssets.length = 0;

  cloudinary.uploader.upload = async (filePath, options = {}) => {
    const ext = path.extname(filePath).toLowerCase();
    let resource_type = "image";
    if (ext === ".mp4" || ext === ".webm") resource_type = "video";
    else if (ext === ".mp3" || ext === ".wav" || ext === ".m4a") resource_type = "video";
    else if (ext === ".pdf" || ext === ".zip" || ext === ".txt") resource_type = "raw";

    const public_id = `test_${crypto.randomUUID()}`;
    const secure_url = `https://res.cloudinary.com/test/${resource_type}/upload/${public_id}${ext}`;
    const asset = {
      public_id,
      secure_url,
      resource_type,
      duration: resource_type === "video" ? 15 : undefined,
    };
    uploadedAssets.push(asset);
    return asset;
  };

  cloudinary.uploader.destroy = async (publicId, options = {}) => {
    deletedAssets.push({ publicId, options });
    return { result: "ok" };
  };
}

// Find a free TCP port
export function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

// Start ephemeral mongod on 127.0.0.1
export async function startEphemeralMongo() {
  mongoPort = await getFreePort();
  mongoDbPath = `/tmp/chat_test_mongo_${Date.now()}_${process.pid}`;
  fs.mkdirSync(mongoDbPath, { recursive: true });

  await new Promise((resolve, reject) => {
    mongodProcess = spawn("/usr/bin/mongod", [
      "--port",
      String(mongoPort),
      "--dbpath",
      mongoDbPath,
      "--bind_ip",
      "127.0.0.1",
    ]);

    let started = false;
    mongodProcess.stdout.on("data", (data) => {
      const str = data.toString();
      if (str.includes("Waiting for connections") || str.includes("waiting for connections")) {
        if (!started) {
          started = true;
          resolve();
        }
      }
    });

    mongodProcess.stderr.on("data", (data) => {
      console.error("[mongod stderr]", data.toString());
    });

    mongodProcess.on("error", (err) => {
      if (!started) reject(err);
    });

    mongodProcess.on("exit", (code) => {
      if (!started) reject(new Error(`mongod exited early with code ${code}`));
    });

    // Fallback polling after 300ms
    setTimeout(async () => {
      if (started) return;
      for (let i = 0; i < 150; i++) {
        try {
          await new Promise((res, rej) => {
            const socket = net.createConnection(mongoPort, "127.0.0.1");
            socket.on("connect", () => {
              socket.end();
              res();
            });
            socket.on("error", rej);
          });
          started = true;
          return resolve();
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
      reject(new Error("Timeout waiting for mongod to start"));
    }, 500);
  });

  return mongoPort;
}

// Initialize environment, database, and test server
export async function setupTestEnvironment() {
  setupCloudinaryMocks();

  const port = await startEphemeralMongo();
  const testDbUri = `mongodb://127.0.0.1:${port}/chat_test_functional`;

  // Set test env vars before importing application code
  process.env.NODE_ENV = "test";
  process.env.MONGO_URI = testDbUri;
  process.env.MONGO_DB = "chat_test_functional";
  process.env.PORT = "0";

  // Connect Mongoose to the throwaway database
  await mongoose.connect(testDbUri);

  // Import app & socket.io server
  const { app, server, io } = await import("../src/infrastructure/socket/socket.js");
  await import("../src/app/app.js");

  appInstance = app;
  serverInstance = server;
  ioInstance = io;

  // Start HTTP server on dynamic port
  serverPort = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address().port);
    });
  });

  return {
    app: appInstance,
    server: serverInstance,
    io: ioInstance,
    port: serverPort,
    mongoPort,
    mongoUri: testDbUri,
  };
}

// Cleanup and shutdown
export async function teardownTestEnvironment() {
  try {
    if (serverInstance && serverInstance.listening) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
  } catch (e) {
    console.error("Error closing server:", e);
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch (e) {
    console.error("Error disconnecting mongoose:", e);
  }

  try {
    if (mongodProcess && !mongodProcess.killed) {
      mongodProcess.kill("SIGKILL");
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    console.error("Error killing mongod:", e);
  }

  try {
    if (mongoDbPath && fs.existsSync(mongoDbPath)) {
      fs.rmSync(mongoDbPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.error("Error removing temp mongo dir:", e);
  }
}
