import "../config/env.config.js";
import connectDB from "../infrastructure/database/db.config.js";
import {
  port,
  mongoUri,
  mongoDbName,
} from "../shared/constants/app.constants.js";
import { server, io } from "../infrastructure/socket/socket.js";
import "../app/app.js";
import { startScheduler } from "../modules/messaging/jobs/scheduler.js";
import { startDisappearingSweeper } from "../modules/messaging/jobs/disappearing.js";
import { startLocationExpiryJob } from "../modules/messaging/jobs/location.js";

process.on("unhandledRejection", (reason) => {
  console.error("[Process] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[Process] Uncaught Exception:", error);
  if (!server.listening) {
    process.exit(1);
  }
});

export const startServer = async () => {
  try {
    await connectDB(mongoUri, mongoDbName);
    console.log("MongoDB connected");

    startScheduler();
    startDisappearingSweeper();
    startLocationExpiryJob(io);

    const listenPort = port || process.env.PORT || 5000;
    server.listen(listenPort, "0.0.0.0", () => {
      console.log(`Server listening on port ${listenPort}`);
      if (process.env.NODE_ENV !== "production") {
        console.log(`Local API: http://localhost:${listenPort}/api/v1`);
        console.log(
          `Swagger Docs API: http://localhost:${listenPort}/api-docs`,
        );
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
};

export default startServer;
