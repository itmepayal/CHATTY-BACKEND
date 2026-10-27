// ==============================
// Environment Configuration
// ==============================
import "./config/env.config.js";

// ==============================
// Database Configuration
// ==============================
import connectDB from "./config/db.config.js";

// ==============================
// Constants
// ==============================
import { port, mongoUri, mongoDbName } from "./constants/constant.js";

// ==============================
// Socket io Server
// ==============================
import { server } from "./lib/socket.js";

// ==============================
// Middlewares and Routes are initialized
// ==============================
import "./app/app.js";

// ==============================
// Scheduler
// ==============================
import { startScheduler } from "./jobs/scheduler.js";
import { startDisappearingSweeper } from "./jobs/disappearing.js";

// ==============================
// Start the Server
// ==============================
connectDB(mongoUri, mongoDbName)
  .then(() => {
    server.listen(port, () => {
      console.log(`Server running at port ${port}`);
      startScheduler();
      startDisappearingSweeper();
    });
  })
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
