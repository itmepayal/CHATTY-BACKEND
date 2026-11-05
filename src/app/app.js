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
import { corsOriginValidator } from "../constants/constants.js";

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
    ],
  }),
);

app.use(cookieParser());

setupSwagger(app);

app.use("/api/v1", router);

app.use(notFoundHandler);
app.use(errorHandler);
