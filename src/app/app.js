import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { app } from "../lib/socket.js";
import router from "../router/index.js";
import {
  errorHandler,
  notFoundHandler,
} from "../middlewares/errorHandler.middleware.js";
import { setupSwagger } from "../config/swagger.js";
import { clientUrl } from "../constants/constants.js";

const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://localhost:8081",
  "https://chatty-app-sigma.vercel.app",
  "https://chatty-backend-2l2t.onrender.com",
  clientUrl,
].filter(Boolean);

app.use(express.json());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

app.use(cookieParser());

setupSwagger(app);

app.use("/api/v1", router);

app.use(notFoundHandler);
app.use(errorHandler);
