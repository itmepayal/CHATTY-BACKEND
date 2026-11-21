import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  GIFTS,
  GIFT_CATEGORIES,
} from "../src/modules/gifts/data/gifts-catalog.data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");
const serverPublicDir = path.resolve(rootDir, "server/public");
const clientPublicDir = path.resolve(rootDir, "client/public");

function runValidation() {
  console.log("==================================================");
  console.log("STARTING ASSET & CATALOG VALIDATION SUITE");
  console.log("==================================================");

  if (!Array.isArray(GIFTS) || GIFTS.length < 600) {
    throw new Error(
      `Catalog must contain at least 600 gifts. Found: ${GIFTS?.length || 0}`,
    );
  }
  console.log(
    `[✓ PASS] Catalog Size: ${GIFTS.length} gifts (Threshold >= 600)`,
  );

  const categoryCounts = {};
  const seenIds = new Set();
  const seenSlugs = new Set();
  const seenNames = new Set();
  const seenAssets = new Set();

  for (const gift of GIFTS) {
    // 1. Unique ID
    if (!gift.id || typeof gift.id !== "string") {
      throw new Error(`Gift missing valid string id: ${JSON.stringify(gift)}`);
    }
    if (seenIds.has(gift.id)) {
      throw new Error(`Duplicate gift ID detected: ${gift.id}`);
    }
    seenIds.add(gift.id);

    // 2. Unique Slug
    if (!gift.slug || typeof gift.slug !== "string") {
      throw new Error(`Gift missing valid slug: ${gift.id}`);
    }
    if (seenSlugs.has(gift.slug)) {
      throw new Error(`Duplicate gift slug detected: ${gift.slug}`);
    }
    seenSlugs.add(gift.slug);

    // 3. Unique Name
    if (!gift.name || typeof gift.name !== "string") {
      throw new Error(`Gift missing valid name: ${gift.id}`);
    }
    if (seenNames.has(gift.name)) {
      throw new Error(`Duplicate gift name detected: ${gift.name}`);
    }
    seenNames.add(gift.name);

    // 4. Valid Price
    if (
      typeof gift.coinPrice !== "number" ||
      gift.coinPrice <= 0 ||
      !Number.isInteger(gift.coinPrice)
    ) {
      throw new Error(
        `Invalid coinPrice for gift ${gift.slug}: ${gift.coinPrice}`,
      );
    }

    // 5. Asset Existence Check
    if (
      !gift.image ||
      typeof gift.image !== "string" ||
      !gift.image.startsWith("/assets/gifts/")
    ) {
      throw new Error(
        `Invalid asset image path for gift ${gift.slug}: ${gift.image}`,
      );
    }

    const relPath = gift.image.replace(/^\//, "");
    const serverFilePath = path.resolve(serverPublicDir, relPath);
    const clientFilePath = path.resolve(clientPublicDir, relPath);

    if (!fs.existsSync(serverFilePath)) {
      throw new Error(`Missing server asset file: ${serverFilePath}`);
    }
    if (!fs.existsSync(clientFilePath)) {
      throw new Error(`Missing client asset file: ${clientFilePath}`);
    }

    const stat = fs.statSync(serverFilePath);
    if (stat.size < 50) {
      throw new Error(`Asset file is empty or corrupted: ${serverFilePath}`);
    }

    // 6. No Shared Assets
    if (seenAssets.has(gift.image)) {
      throw new Error(`Asset is shared between multiple gifts: ${gift.image}`);
    }
    seenAssets.add(gift.image);

    // Count categories
    categoryCounts[gift.category] = (categoryCounts[gift.category] || 0) + 1;
  }

  console.log(
    `[✓ PASS] Uniqueness: 600 unique IDs, 600 unique Slugs, 600 unique Names`,
  );
  console.log(
    `[✓ PASS] Asset Integrity: 600 distinct visual assets exist on disk with valid file size`,
  );
  console.log(
    `[✓ PASS] Price Integrity: All 600 gifts have valid integer coin prices`,
  );

  // 7. Verify Categories
  const categoryNames = Object.keys(categoryCounts);
  if (categoryNames.length < 15) {
    throw new Error(
      `Expected at least 15 categories, found: ${categoryNames.length}`,
    );
  }
  console.log(
    `[✓ PASS] Categories: ${categoryNames.length} distinct categories present`,
  );

  const expectedTargets = {
    "Love & Romance": 50,
    "Flowers & Nature": 40,
    "Cute Animals": 45,
    "Pets & Companions": 35,
    "Birthday & Celebration": 45,
    "Friendship": 35,
    "Festivals & Traditions": 45,
    "Food & Drinks": 40,
    "Luxury & Premium": 45,
    "Fantasy & Magic": 40,
    "Gaming & Entertainment": 35,
    "Travel & Adventure": 35,
    "Funny & Memes": 30,
    "Special Occasions": 40,
    "Seasonal & Limited Edition": 40,
  };

  for (const [catName, target] of Object.entries(expectedTargets)) {
    const count = categoryCounts[catName] || 0;
    if (count < target) {
      throw new Error(
        `Category '${catName}' has only ${count} gifts (minimum required: ${target})`,
      );
    }
  }
  console.log(
    `[✓ PASS] Category Distribution: Every category meets or exceeds exact target count across all 15 categories`,
  );

  console.log("==================================================");
  console.log("ALL 600+ VIRTUAL GIFT MARKETPLACE ASSET CHECKS PASSED!");
  console.log("==================================================");
}

runValidation();
