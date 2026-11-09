/**
 * Migration Script: Fix Message Client ID Index & Add ExpiresAt Index
 *
 * Purpose:
 * 1. Drops the old sparse unique index "senderId_1_clientId_1" on the messages collection.
 * 2. Re-creates "senderId_1_clientId_1" with partialFilterExpression: { clientId: { $type: "string" } }
 *    so documents without clientId do NOT collide.
 * 3. Creates compound index "expiresAt_1_isDeleted_1" to speed up the disappearing messages sweeper.
 *
 * Usage:
 *   cd server
 *   node scripts/fix-message-client-id-index.js
 */

import mongoose from "mongoose";
import "../src/config/env.config.js";
import { mongoUri, mongoDbName } from "../src/constants/constants.js";

async function runMigration() {
  console.log("[Migration] Connecting to MongoDB...");
  await mongoose.connect(mongoUri, { dbName: mongoDbName });
  console.log("[Migration] Connected successfully.");

  const collection = mongoose.connection.collection("messages");

  // 1. Inspect existing indexes
  const existingIndexes = await collection.indexes();
  console.log(
    "[Migration] Existing indexes on 'messages':",
    existingIndexes.map((idx) => idx.name),
  );

  const oldIndexExists = existingIndexes.some(
    (idx) => idx.name === "senderId_1_clientId_1",
  );

  if (oldIndexExists) {
    console.log("[Migration] Dropping old index 'senderId_1_clientId_1'...");
    try {
      await collection.dropIndex("senderId_1_clientId_1");
      console.log("[Migration] Successfully dropped 'senderId_1_clientId_1'.");
    } catch (err) {
      console.warn(
        "[Migration] Warning dropping index:",
        err?.message || err,
      );
    }
  } else {
    console.log(
      "[Migration] Index 'senderId_1_clientId_1' not found, skipping drop.",
    );
  }

  // 2. Create the new partial unique index
  console.log(
    "[Migration] Creating partial unique index on { senderId: 1, clientId: 1 }...",
  );
  await collection.createIndex(
    { senderId: 1, clientId: 1 },
    {
      unique: true,
      partialFilterExpression: { clientId: { $type: "string" } },
      name: "senderId_1_clientId_1",
    },
  );
  console.log(
    "[Migration] Successfully created new partial unique index 'senderId_1_clientId_1'.",
  );

  // 3. Create index for disappearing messages
  console.log(
    "[Migration] Creating index on { expiresAt: 1, isDeleted: 1 }...",
  );
  await collection.createIndex(
    { expiresAt: 1, isDeleted: 1 },
    { name: "expiresAt_1_isDeleted_1" },
  );
  console.log(
    "[Migration] Successfully created index 'expiresAt_1_isDeleted_1'.",
  );

  console.log("[Migration] Migration completed successfully!");
}

runMigration()
  .catch((err) => {
    console.error("[Migration] Migration failed with error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await mongoose.disconnect();
    console.log("[Migration] Disconnected from MongoDB.");
    process.exit(0);
  });

