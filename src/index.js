import "./config/env.config.js";
import connectDB from "./config/db.config.js";
import { port, mongoUri, mongoDbName } from "./constants/constants.js";
import { server, io } from "./lib/socket.js";
import "./app/app.js";
import { startScheduler } from "./jobs/scheduler.js";
import { startDisappearingSweeper } from "./jobs/disappearing.js";
import { startLocationExpiryJob } from "./jobs/location.js";

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception:", error);
  if (!server.listening) {
    process.exit(1);
  }
});

const startServer = async () => {
  try {
    await connectDB(mongoUri, mongoDbName);
    console.log("MongoDB connected");

    startScheduler();
    startDisappearingSweeper();
    startLocationExpiryJob(io);

    server.listen(port, "0.0.0.0", () => {
      if (process.env.NODE_ENV != "production") {
        console.log(`Server running on http://0.0.0.0:${port}`);
        console.log(`Local API: http://localhost:${port}/api/v1`);
        console.log(`Swagger Docs API: http://localhost:${port}/api-docs`);
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

startServer();
