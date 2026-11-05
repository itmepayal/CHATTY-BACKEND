import { config } from "dotenv";
import fs from "fs";

if (fs.existsSync("./server/.env")) {
  config({ path: "./server/.env" });
} else {
  config({ path: "./.env" });
}

const currentEnv = process.env.NODE_ENV || "development";

if (currentEnv === "test") {
  if (fs.existsSync("./server/.env.test")) {
    config({ path: "./server/.env.test", override: true });
  } else {
    config({ path: "./.env.test", override: true });
  }
}

export default process.env;
