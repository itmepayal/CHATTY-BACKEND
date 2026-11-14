import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers, TEST_PASSWORD } from "./auth-helper.js";
import { VALID_THEMES } from "../src/modules/privacy/constants/privacy.constants.js";
import User from "../src/modules/users/models/users.model.js";

async function runTests() {
  console.log("Setting up test environment for appearance settings...");
  const env = await setupTestEnvironment();
  let passed = 0;
  let failed = 0;

  const testCase = async (name, fn) => {
    try {
      await fn();
      console.log(`[✓ PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[✗ FAIL] ${name}:`, err.message);
      failed++;
    }
  };

  try {
    const sessions = await createAndLoginUsers(env.app, env.port);
    const { alice } = sessions;
    const cookies = alice.cookies;

    // 1. GET /api/v1/users/appearance returns default settings
    await testCase("GET /api/v1/users/appearance returns default settings", async () => {
      const res = await request(env.app)
        .get("/api/v1/users/appearance")
        .set("Cookie", cookies);

      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      assert.equal(res.body.success, true);
      const data = res.body.data;
      assert.equal(data.theme, "light");
      assert.equal(data.fontSize, "md");
      assert.equal(data.bubbleStyle, "rounded");
      assert.equal(data.density, "comfortable");
      assert.equal(data.showTimestamps, true);
      assert.equal(data.timeFormat, "12h");
      // Verify nested appearance shape
      assert.ok(data.appearance);
      assert.equal(data.appearance.theme, "light");
      assert.equal(data.appearance.fontSize, "md");
      assert.equal(data.appearance.bubbleStyle, "rounded");
      assert.equal(data.appearance.density, "comfortable");
      assert.equal(data.appearance.showTimestamps, true);
      assert.equal(data.appearance.timeFormat, "12h");
    });

    // 2. PATCH /api/v1/users/appearance with { theme: "nord" } fixes the reported bug
    await testCase("PATCH /api/v1/users/appearance with { theme: 'nord' } succeeds", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ theme: "nord" });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.success, true);
      assert.equal(res.body.data.theme, "nord");
      assert.equal(res.body.data.appearance.theme, "nord");
      // Other settings must remain default
      assert.equal(res.body.data.fontSize, "md");
      assert.equal(res.body.data.bubbleStyle, "rounded");
      assert.equal(res.body.data.density, "comfortable");
      assert.equal(res.body.data.showTimestamps, true);
      assert.equal(res.body.data.timeFormat, "12h");
    });

    // 3. PATCH /api/v1/users/appearance supports all 35 DaisyUI themes
    await testCase("PATCH /api/v1/users/appearance supports all 35 DaisyUI themes", async () => {
      assert.equal(VALID_THEMES.length, 35, `Expected 35 valid themes, found ${VALID_THEMES.length}`);
      for (const t of VALID_THEMES) {
        const res = await request(env.app)
          .patch("/api/v1/users/appearance")
          .set("Cookie", cookies)
          .send({ theme: t });

        assert.equal(res.status, 200, `Failed for theme "${t}": ${JSON.stringify(res.body)}`);
        assert.equal(res.body.data.theme, t);
      }
    });

    // 4. Partial updates do not overwrite untouched fields
    await testCase("Partial updates preserve other appearance fields", async () => {
      // Set to synthwave first
      await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ theme: "synthwave" });

      // Update fontSize only
      const res1 = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ fontSize: "lg" });
      assert.equal(res1.status, 200);
      assert.equal(res1.body.data.theme, "synthwave", "Theme should still be synthwave");
      assert.equal(res1.body.data.fontSize, "lg");

      // Update bubbleStyle only
      const res2 = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ bubbleStyle: "sharp" });
      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.theme, "synthwave");
      assert.equal(res2.body.data.fontSize, "lg");
      assert.equal(res2.body.data.bubbleStyle, "sharp");

      // Update density only
      const res3 = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ density: "compact" });
      assert.equal(res3.status, 200);
      assert.equal(res3.body.data.theme, "synthwave");
      assert.equal(res3.body.data.fontSize, "lg");
      assert.equal(res3.body.data.bubbleStyle, "sharp");
      assert.equal(res3.body.data.density, "compact");

      // Update showTimestamps only (to false)
      const res4 = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ showTimestamps: false });
      assert.equal(res4.status, 200);
      assert.equal(res4.body.data.theme, "synthwave");
      assert.equal(res4.body.data.showTimestamps, false);

      // Update timeFormat only
      const res5 = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ timeFormat: "24h" });
      assert.equal(res5.status, 200);
      assert.equal(res5.body.data.theme, "synthwave");
      assert.equal(res5.body.data.fontSize, "lg");
      assert.equal(res5.body.data.bubbleStyle, "sharp");
      assert.equal(res5.body.data.density, "compact");
      assert.equal(res5.body.data.showTimestamps, false);
      assert.equal(res5.body.data.timeFormat, "24h");
    });

    // 5. Verification of persistence in database and fresh GET
    await testCase("Verification of persistence across fresh GET", async () => {
      const res = await request(env.app)
        .get("/api/v1/users/appearance")
        .set("Cookie", cookies);

      assert.equal(res.status, 200);
      assert.equal(res.body.data.theme, "synthwave");
      assert.equal(res.body.data.fontSize, "lg");
      assert.equal(res.body.data.bubbleStyle, "sharp");
      assert.equal(res.body.data.density, "compact");
      assert.equal(res.body.data.showTimestamps, false);
      assert.equal(res.body.data.timeFormat, "24h");

      // Verify raw Mongoose document fields
      const user = await User.findById(alice.user._id);
      assert.equal(user.theme, "synthwave");
      assert.equal(user.fontSize, "lg");
      assert.equal(user.bubbleStyle, "sharp");
      assert.equal(user.density, "compact");
      assert.equal(user.showTimestamps, false);
      assert.equal(user.timeFormat, "24h");
      // Legacy fields also preserved
      assert.equal(user.appearanceTheme, "synthwave");
      assert.equal(user.appearanceFontSize, "lg");
      assert.equal(user.appearanceBubbleStyle, "sharp");
      assert.equal(user.appearanceDensity, "compact");
      assert.equal(user.appearanceTimestamps, false);
      assert.equal(user.appearanceTimeFormat, "24h");
    });

    // 6. Normalization of cross-platform / mobile aliases
    await testCase("Aliases and normalizations are correctly mapped", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({
          fontSize: "small",
          bubbleStyle: "round",
          density: "cozy",
          timeFormat: "12-hour",
          timestamps: true,
        });

      assert.equal(res.status, 200, `Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.data.fontSize, "sm");
      assert.equal(res.body.data.bubbleStyle, "rounded");
      assert.equal(res.body.data.density, "comfortable");
      assert.equal(res.body.data.timeFormat, "12h");
      assert.equal(res.body.data.showTimestamps, true);

      // Test compactMode boolean alias
      const res2 = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ compactMode: true });
      assert.equal(res2.status, 200);
      assert.equal(res2.body.data.density, "compact");

      // Test messageSpacing alias
      const res3 = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ messageSpacing: "cozy" });
      assert.equal(res3.status, 200);
      assert.equal(res3.body.data.density, "comfortable");
    });

    // 7. Error handling: invalid theme rejected
    await testCase("Invalid theme rejected with 400 Bad Request", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ theme: "non-existent-theme-xyz" });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Invalid value for "theme"/);
    });

    // 8. Error handling: unknown field rejected
    await testCase("Unknown field rejected with 400 Bad Request", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ invalidKey: 123 });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /Unknown field\(s\): invalidKey/);
    });

    // 9. Error handling: invalid boolean rejected
    await testCase("Non-boolean for showTimestamps rejected with 400", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ showTimestamps: "yes" });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /must be a boolean/);
    });

    // 10. Error handling: empty body rejected
    await testCase("Empty body rejected with 400", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({});

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
      assert.match(res.body.message, /No appearance fields provided/);
    });

    // 11. Authentication check
    await testCase("Unauthenticated request rejected with 401 Unauthorized", async () => {
      const resGet = await request(env.app).get("/api/v1/users/appearance");
      assert.equal(resGet.status, 401);

      const resPatch = await request(env.app)
        .patch("/api/v1/users/appearance")
        .send({ theme: "dark" });
      assert.equal(resPatch.status, 401);
    });

    // 12. Sequential transitions: Light -> Dark -> Cupcake
    await testCase("Sequential theme transitions (Light -> Dark -> Cupcake)", async () => {
      // 1. Light -> Dark
      const resDark = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ theme: "dark" });
      assert.equal(resDark.status, 200);
      assert.equal(resDark.body.data.theme, "dark");

      // 2. Dark -> Cupcake
      const resCupcake = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({ theme: "cupcake" });
      assert.equal(resCupcake.status, 200);
      assert.equal(resCupcake.body.data.theme, "cupcake");

      // Verify in DB
      const user = await User.findById(alice.user._id);
      assert.equal(user.appearanceTheme, "cupcake");
    });

    // 13. Update multiple appearance settings simultaneously in one request
    await testCase("Update multiple appearance settings simultaneously", async () => {
      const res = await request(env.app)
        .patch("/api/v1/users/appearance")
        .set("Cookie", cookies)
        .send({
          theme: "dracula",
          fontSize: "lg",
          bubbleStyle: "soft",
          density: "compact",
          showTimestamps: false,
          timeFormat: "24h",
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.data.theme, "dracula");
      assert.equal(res.body.data.fontSize, "lg");
      assert.equal(res.body.data.bubbleStyle, "soft");
      assert.equal(res.body.data.density, "compact");
      assert.equal(res.body.data.showTimestamps, false);
      assert.equal(res.body.data.timeFormat, "24h");
    });

    // 14. Persistence across logout, login, and auth check
    await testCase("Preferences persist across logout, re-login, and checkAuth", async () => {
      // 1. Log out
      const logoutRes = await request(env.app)
        .post("/api/v1/auth/logout")
        .set("Cookie", cookies);
      assert.equal(logoutRes.status, 200);

      // 2. Re-login
      const loginRes = await request(env.app)
        .post("/api/v1/auth/login")
        .send({ email: "alice@test.com", password: TEST_PASSWORD });
      assert.equal(loginRes.status, 200);
      const newCookies = (loginRes.headers["set-cookie"] || [])
        .map((c) => c.split(";")[0])
        .join("; ");

      // Check login response payload includes appearance settings
      const loginUser = loginRes.body.data?.user || loginRes.body.data;
      assert.equal(loginUser.appearanceTheme, "dracula");
      assert.equal(loginUser.appearanceFontSize, "lg");
      assert.equal(loginUser.appearanceBubbleStyle, "soft");
      assert.equal(loginUser.appearanceDensity, "compact");
      assert.equal(loginUser.appearanceTimestamps, false);
      assert.equal(loginUser.appearanceTimeFormat, "24h");

      // 3. checkAuth endpoint verification
      const checkRes = await request(env.app)
        .get("/api/v1/auth/check")
        .set("Cookie", newCookies);
      assert.equal(checkRes.status, 200);
      const checkUser = checkRes.body.data?.user || checkRes.body.data;
      assert.equal(checkUser.appearanceTheme, "dracula");
      assert.equal(checkUser.appearanceFontSize, "lg");
      assert.equal(checkUser.appearanceBubbleStyle, "soft");
      assert.equal(checkUser.appearanceDensity, "compact");
      assert.equal(checkUser.appearanceTimestamps, false);
      assert.equal(checkUser.appearanceTimeFormat, "24h");

      // 4. GET /api/v1/users/appearance with new session
      const getRes = await request(env.app)
        .get("/api/v1/users/appearance")
        .set("Cookie", newCookies);
      assert.equal(getRes.status, 200);
      assert.equal(getRes.body.data.theme, "dracula");
      assert.equal(getRes.body.data.fontSize, "lg");
      assert.equal(getRes.body.data.bubbleStyle, "soft");
      assert.equal(getRes.body.data.density, "compact");
      assert.equal(getRes.body.data.showTimestamps, false);
      assert.equal(getRes.body.data.timeFormat, "24h");
    });

  } finally {
    console.log("Tearing down test environment...");
    await teardownTestEnvironment();
  }

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
