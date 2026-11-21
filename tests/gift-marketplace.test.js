import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import { seedGifts } from "../scripts/seed-gifts.js";
import { Gift } from "../src/modules/gifts/models/gift.model.js";
import { Wallet } from "../src/modules/gifts/models/wallet.model.js";

test("500+ Virtual Gifts Marketplace & Gifting System Test Suite", async (t) => {
  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port);
  const { alice, bob, charlie } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);

  // Set Alice as admin for admin route tests
  alice.user.role = "admin";
  await alice.user.save();

  let redRoseGift;
  let testGroupId;

  await t.test("1. Catalog Seeding & Total Count Verification", async () => {
    const seedResult = await seedGifts();
    assert.ok(seedResult.success);
    assert.equal(seedResult.count, 600);

    const totalInDb = await Gift.countDocuments();
    assert.equal(totalInDb, 600);
  });

  await t.test("2. GET /api/v1/gifts - Catalog Pagination & Filtering", async () => {
    // 2.1 Fetch first page
    const res = await request(app)
      .get("/api/v1/gifts?page=1&limit=50")
      .expect(200);

    assert.ok(res.body?.success);
    assert.equal(res.body.data.gifts.length, 50);
    assert.equal(res.body.data.pagination.total, 600);
    assert.equal(res.body.data.pagination.totalPages, 12);

    // 2.2 Category filter
    const catRes = await request(app)
      .get("/api/v1/gifts?category=love&limit=100")
      .expect(200);

    assert.ok(catRes.body?.success);
    const catGifts = catRes.body.data.gifts || catRes.body.data.items || [];
    assert.ok(catGifts.length >= 20);
    catGifts.forEach((g) => {
      assert.equal(g.category, "Love & Romance");
    });

    // 2.3 Search filter
    const searchRes = await request(app)
      .get("/api/v1/gifts?search=rose")
      .expect(200);

    assert.ok(searchRes.body?.success);
    assert.ok(searchRes.body.data.gifts.length > 0);
    redRoseGift = searchRes.body.data.gifts.find((g) => g.slug === "red-rose");
    assert.ok(redRoseGift);
  });

  await t.test("3. GET /api/v1/gifts/categories - 15 Unique Categories", async () => {
    const res = await request(app)
      .get("/api/v1/gifts/categories")
      .expect(200);

    assert.ok(res.body?.success);
    const categories = res.body.data;
    assert.equal(categories.length, 15);

    categories.forEach((cat) => {
      assert.ok(cat.itemCount >= 20, `Category ${cat.id} has less than 20 items: ${cat.itemCount}`);
      assert.ok(cat.name);
      assert.ok(cat.icon);
    });
  });

  await t.test("3.1 Favorites System - Toggle & Retrieve User Favorites", async () => {
    // Alice favorites red-rose
    const favRes = await request(app)
      .post("/api/v1/gifts/red-rose/favorite")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(favRes.body?.success);
    assert.equal(favRes.body.data.isFavorited, true);
    assert.equal(favRes.body.data.giftSlug, "red-rose");

    // Alice fetches her favorites
    const getFavsRes = await request(app)
      .get("/api/v1/gifts/favorites")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(getFavsRes.body?.success);
    assert.ok(Array.isArray(getFavsRes.body.data));
    assert.ok(getFavsRes.body.data.some((g) => g.slug === "red-rose"));

    // Alice un-favorites red-rose using the alternate toggle path
    const unfavRes = await request(app)
      .post("/api/v1/gifts/favorites/toggle/red-rose")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(unfavRes.body?.success);
    assert.equal(unfavRes.body.data.isFavorited, false);
  });

  await t.test("4. GET /api/v1/gifts/featured & Single Lookup", async () => {
    const featRes = await request(app)
      .get("/api/v1/gifts/featured")
      .expect(200);

    assert.ok(featRes.body?.success);
    assert.ok(Array.isArray(featRes.body.data.trending));
    assert.ok(Array.isArray(featRes.body.data.popular));
    assert.ok(Array.isArray(featRes.body.data.luxury));

    // Lookup single gift by slug
    const singleRes = await request(app)
      .get("/api/v1/gifts/red-rose")
      .expect(200);

    assert.ok(singleRes.body?.success);
    assert.equal(singleRes.body.data.slug, "red-rose");
    assert.equal(singleRes.body.data.name, "Red Rose");
  });

  await t.test("5. Wallet System: Initial Balance & Daily Bonus Claim", async () => {
    // 5.1 Check initial wallet balance (default 500)
    const walletRes = await request(app)
      .get("/api/v1/gifts/wallet/me")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(walletRes.body?.success);
    assert.equal(walletRes.body.data.balance, 500);
    assert.equal(walletRes.body.data.canClaimDailyBonus, true);

    // 5.2 Claim daily bonus (+100)
    const claimRes = await request(app)
      .post("/api/v1/gifts/wallet/claim-daily-bonus")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(claimRes.body?.success);
    assert.equal(claimRes.body.data.balance, 600); // 500 + 100

    // 5.3 Attempt second claim within 24h should fail with 429
    const secondClaimRes = await request(app)
      .post("/api/v1/gifts/wallet/claim-daily-bonus")
      .set("Cookie", alice.cookies)
      .expect(429);

    assert.equal(secondClaimRes.body?.success, false);
  });

  await t.test("6. Send Gift 1:1 Direct - Atomic Deduction & Chat Integration", async () => {
    redRoseGift = await Gift.findOne({ slug: "red-rose" }).lean();
    const idempotencyKey = `test-tx-${Date.now()}`;
    const sendRes = await request(app)
      .post("/api/v1/gifts/send")
      .set("Cookie", alice.cookies)
      .send({
        giftSlug: "red-rose",
        recipientId: bobId,
        note: "Thinking of you!",
        idempotencyKey,
      })
      .expect(201);

    assert.ok(sendRes.body?.success);
    assert.equal(sendRes.body.data.gift.name, "Red Rose");
    assert.equal(sendRes.body.data.message.messageType, "gift");
    assert.ok(sendRes.body.data.message.gift);
    assert.equal(sendRes.body.data.message.gift.slug, "red-rose");

    // Check Alice's new wallet balance (600 - red-rose price)
    const expectedBalance = 600 - redRoseGift.coinPrice;
    assert.equal(sendRes.body.data.senderBalance, expectedBalance);

    // Test Idempotency: replaying same idempotencyKey returns cached response without double charge
    const replayRes = await request(app)
      .post("/api/v1/gifts/send")
      .set("Cookie", alice.cookies)
      .send({
        giftSlug: "red-rose",
        recipientId: bobId,
        note: "Thinking of you!",
        idempotencyKey,
      })
      .expect(200);

    assert.ok(replayRes.body?.success);
    assert.equal(replayRes.body.idempotentReplay, true);
  });

  await t.test("7. Insufficient Funds Handling", async () => {
    const expensiveGift = await Gift.findOne({ coinPrice: { $gt: 1000 } }).lean();
    assert.ok(expensiveGift);

    const failRes = await request(app)
      .post("/api/v1/gifts/send")
      .set("Cookie", alice.cookies)
      .send({
        giftId: expensiveGift._id,
        recipientId: bobId,
      })
      .expect(400);

    assert.equal(failRes.body?.success, false);
    assert.match(failRes.body?.message, /insufficient/i);
  });

  await t.test("8. Send Gift in Group Chat", async () => {
    // Create test group
    const groupRes = await request(app)
      .post("/api/v1/groups")
      .set("Cookie", alice.cookies)
      .send({
        name: "Gifting Circle",
        memberIds: JSON.stringify([bobId, charlieId]),
      })
      .expect(201);

    testGroupId = groupRes.body?.data?.id || groupRes.body?.data?._id;

    // Send group gift
    const groupGiftRes = await request(app)
      .post("/api/v1/gifts/send")
      .set("Cookie", alice.cookies)
      .send({
        giftSlug: "red-rose",
        groupId: testGroupId,
        note: "For everyone in the group!",
      })
      .expect(201);

    assert.ok(groupGiftRes.body?.success);
    assert.equal(groupGiftRes.body.data.isGroup, true);
    assert.equal(groupGiftRes.body.data.message.messageType, "gift");
    assert.equal(groupGiftRes.body.data.message.gift.slug, "red-rose");
  });

  await t.test("9. User Sent & Received Gift History", async () => {
    // Alice's sent gifts
    const sentRes = await request(app)
      .get("/api/v1/gifts/history/sent")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(sentRes.body?.success);
    const sentItems = sentRes.body.data.items || sentRes.body.data;
    assert.ok(sentItems.length >= 2);

    // Bob's received gifts
    const recRes = await request(app)
      .get("/api/v1/gifts/history/received")
      .set("Cookie", bob.cookies)
      .expect(200);

    assert.ok(recRes.body?.success);
    const recItems = recRes.body.data.items || recRes.body.data;
    assert.ok(recItems.length >= 1);
    assert.ok(recItems.some((i) => (i.gift?.slug || i.giftSlug) === "red-rose"));
  });

  await t.test("10. Admin Operations & Price Preservation on Reseed", async () => {
    // 10.1 Admin updates red-rose price to 999 coins
    const updateRes = await request(app)
      .patch("/api/v1/gifts/admin/red-rose")
      .set("Cookie", alice.cookies)
      .send({ coinPrice: 999 })
      .expect(200);

    assert.ok(updateRes.body?.success);
    assert.equal(updateRes.body.data.coinPrice, 999);

    // 10.2 Reseed catalog - must preserve 999 coin price via $setOnInsert
    await seedGifts();
    const updatedRose = await Gift.findOne({ slug: "red-rose" });
    assert.equal(updatedRose.coinPrice, 999);

    // 10.3 Admin credits Bob's wallet +5000 coins
    const creditRes = await request(app)
      .post("/api/v1/gifts/admin/wallet/credit")
      .set("Cookie", alice.cookies)
      .send({
        userId: bobId,
        amount: 5000,
        reason: "VIP contest winner",
      })
      .expect(200);

    assert.ok(creditRes.body?.success);
    assert.ok(creditRes.body.data.balance >= 5500);
  });

  t.after(async () => {
    await teardownTestEnvironment();
  });
});
