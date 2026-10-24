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
// Socket.IO Initialize
// ==============================
import { app } from "../lib/socket.js";

// ==============================
// Swagger Configuration
// ==============================
import { setupSwagger } from "../config/swagger.js";

// ==============================
// Constants
// ==============================
import { clientUrl } from "../constants/constant.js";

// ==============================
// Middleware to parse JSON
// ==============================
app.use(express.json());

// ==============================
// CORS Configuration
// ==============================
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "https://chatty-app-sigma.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// ==============================
// Cookie Parser
// ==============================
app.use(cookieParser());

// ==============================
// Swagger Documentation
// Register before application routes
// ==============================
setupSwagger(app);

// ==============================
// Register API Routes
// ==============================
app.use("/api/v1", router);

// ==============================
// 404 + Global Error Handler
// ==============================
app.use(notFoundHandler);
app.use(errorHandler);
