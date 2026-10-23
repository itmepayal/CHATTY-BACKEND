// ==============================
// Import Dependencies
// ==============================
import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import router from "../router/route.js";
import {
  errorHandler,
  notFoundHandler,
} from "../middlewares/errorHandler.middleware.js";

// ==============================
// Socket Io Initialize
// ==============================
import { app } from "../lib/socket.js";

// ==============================
// Middleware to parse JSON request bodies
// ==============================
app.use(express.json());

// ==============================
// CORS
// ==============================
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  }),
);

// ==============================
// Cookies Parses
// ==============================
app.use(cookieParser());

// ==============================
// Register Routes
// ==============================
app.use("/api/v1", router);

// ==============================
// 404 + Global Error Handler
// ==============================
app.use(notFoundHandler);
app.use(errorHandler);
