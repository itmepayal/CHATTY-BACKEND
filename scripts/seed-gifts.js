import "../src/config/env.config.js";
import mongoose from "mongoose";
import Gift from "../src/modules/gifts/models/gift.model.js";
import { GIFTS } from "../src/modules/gifts/data/gifts-catalog.data.js";

export async function seedGifts(options = {}) {
  const { quiet = false, uri } = options;
  const mongoUri = uri || process.env.MONGODB_URI || process.env.MONGO_URI;

  const shouldClose = !mongoose.connection.readyState;
  if (!mongoose.connection.readyState) {
    if (!mongoUri) {
      throw new Error("MONGODB_URI environment variable is missing.");
    }
    await mongoose.connect(mongoUri);
    if (!quiet) console.log("[seed-gifts] Connected to MongoDB.");
  }

  if (!quiet) {
    console.log(`[seed-gifts] Seeding ${GIFTS.length} gifts into database...`);
  }

  let createdCount = 0;
  let updatedCount = 0;

  const bulkOps = [];
  for (const item of GIFTS) {
    bulkOps.push({
      updateOne: {
        filter: { slug: item.slug },
        update: {
          $set: {
            name: item.name,
            customId: item.id || item.slug,
            description: item.description,
            category: item.category,
            subcategory: item.subcategory,
            tags: item.tags,
            icon: item.icon,
            image: item.image,
            thumbnail: item.thumbnail,
            animationAsset: item.animationAsset,
            assetType: item.assetType,
            isAnimated: item.isAnimated,
            isPremium: item.isPremium,
            isPopular: item.isPopular,
            isTrending: item.isTrending,
            isLimitedEdition: item.isLimitedEdition,
            isNew: item.isNew,
            isActive: item.isActive !== false,
            displayOrder: item.displayOrder,
            rarity: item.rarity,
            gradient: item.gradient,
            badge: item.badge,
            color: item.color,
          },
          $setOnInsert: {
            coinPrice: item.coinPrice,
          },
        },
        upsert: true,
      },
    });
  }

  if (bulkOps.length > 0) {
    const res = await Gift.bulkWrite(bulkOps, { ordered: false });
    createdCount = res.upsertedCount || 0;
    updatedCount = res.modifiedCount || 0;
  }

  const totalInDb = await Gift.countDocuments();
  if (!quiet) {
    console.log(
      `[seed-gifts] Completed: ${createdCount} created, ${updatedCount} updated. Total in DB: ${totalInDb}`,
    );
  }

  if (shouldClose) {
    await mongoose.disconnect();
    if (!quiet) console.log("[seed-gifts] Disconnected from MongoDB.");
  }

  return {
    success: true,
    count: totalInDb,
    createdCount,
    updatedCount,
    totalInDb,
  };
}

if (process.argv[1]?.endsWith("seed-gifts.js")) {
  seedGifts()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[seed-gifts] Error seeding gifts:", err);
      process.exit(1);
    });
}
