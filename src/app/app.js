import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import path from "path";
import fs from "fs";
import { app } from "../infrastructure/socket/socket.js";
import router from "./routes.js";
import {
  errorHandler,
  notFoundHandler,
} from "../middlewares/errorHandler.middleware.js";
import { setupSwagger } from "../config/swagger.js";
import { corsOriginValidator } from "../shared/constants/app.constants.js";

// Trust reverse proxy (Render, Cloudflare, etc.)
app.set("trust proxy", 1);

// Lightweight health check endpoint for Render keep-alive and uptime monitoring
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use(express.json());

app.use(
  cors({
    origin: corsOriginValidator,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Refresh-Token",
      "x-refresh-token",
      "X-Chat-Unlock-Token",
    ],
  }),
);

app.use(cookieParser());

setupSwagger(app);

const publicDir = fs.existsSync(path.resolve(process.cwd(), "server/public"))
  ? path.resolve(process.cwd(), "server/public")
  : path.resolve(process.cwd(), "public");

app.use("/assets", express.static(path.join(publicDir, "assets")));
app.use("/public", express.static(publicDir));
app.use("/upload", express.static(path.join(publicDir, "upload")));
app.use("/uploads", express.static(path.join(publicDir, "upload")));

app.use("/api/v1", router);
app.use("/api", router);

app.use(notFoundHandler);
app.use(errorHandler);
