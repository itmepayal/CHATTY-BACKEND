import "./config/env.config.js";
import connectDB from "./config/db.config.js";
import { port, mongoUri, mongoDbName } from "./constants/constants.js";
import { server, io } from "./lib/socket.js";
import "./app/app.js";
import { startScheduler } from "./jobs/scheduler.js";
import { startDisappearingSweeper } from "./jobs/disappearing.js";
import { startLocationExpiryJob } from "./jobs/location.js";

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

connectDB(mongoUri, mongoDbName)
  .then(() => {
    console.log("MongoDB connected");
    startScheduler();
    startDisappearingSweeper();
    startLocationExpiryJob(io);
  })
  .catch((error) => {
    console.error("Failed to connect to database:", error.message);
    process.exit(1);
  });
