import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import User from "../src/modules/users/models/users.model.js";
import { extractUserIdentifierFromPayload } from "../src/modules/users/controllers/users.controller.js";

test("Master Suite: QR Code Generation, Deep Linking & Resolution", async (t) => {
  const env = await setupTestEnvironment();
  const { app, server } = env;

  let alice, bob, port;

  t.after(async () => {
    if (alice?.socket?.connected) alice.socket.disconnect();
    if (bob?.socket?.connected) bob.socket.disconnect();
    await teardownTestEnvironment(env);
  });

  await t.test("Setup test users with known usernames", async () => {
    port = server.address().port;
    const sessions = await createAndLoginUsers(app, port, { makeContacts: false });
    alice = sessions.alice;
    bob = sessions.bob;

    await User.findByIdAndUpdate(alice.user._id, {
      username: "alice_deep",
      phone: "+15551112222",
    });
    await User.findByIdAndUpdate(bob.user._id, {
      username: "bob_deep",
      phone: "+15553334444",
    });
  });

  await t.test("1. extractUserIdentifierFromPayload unit validation", () => {
    // Custom schemes
    assert.equal(extractUserIdentifierFromPayload("chatty://user/itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("chatty://user/itmepayal/"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("chatty://profile/itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("chatty://u/itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("web+chatty://user/itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("chatty://itmepayal"), "itmepayal");

    // Full HTTPS / HTTP URLs
    assert.equal(
      extractUserIdentifierFromPayload("https://chatty-app-sigma.vercel.app/user/itmepayal"),
      "itmepayal",
    );
    assert.equal(
      extractUserIdentifierFromPayload("http://localhost:5173/user/itmepayal"),
      "itmepayal",
    );
    assert.equal(
      extractUserIdentifierFromPayload("https://chatty-app-sigma.vercel.app/profile/itmepayal"),
      "itmepayal",
    );
    assert.equal(
      extractUserIdentifierFromPayload("http://localhost:5173/u/itmepayal"),
      "itmepayal",
    );

    // Relative paths
    assert.equal(extractUserIdentifierFromPayload("/user/itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("/u/itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("/profile/itmepayal"), "itmepayal");

    // JSON payloads
    assert.equal(
      extractUserIdentifierFromPayload('{"type":"chatty_user","username":"itmepayal"}'),
      "itmepayal",
    );
    assert.equal(
      extractUserIdentifierFromPayload('{"shareUrl":"https://chatty.com/user/itmepayal"}'),
      "itmepayal",
    );
    assert.equal(
      extractUserIdentifierFromPayload('{"shareUrl":"chatty://user/itmepayal"}'),
      "itmepayal",
    );

    // Direct handles and raw identifiers
    assert.equal(extractUserIdentifierFromPayload("@itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("itmepayal"), "itmepayal");
    assert.equal(extractUserIdentifierFromPayload("6b0062eb2b8389a17e43e119"), "6b0062eb2b8389a17e43e119");

    // Invalid / empty
    assert.equal(extractUserIdentifierFromPayload(""), null);
    assert.equal(extractUserIdentifierFromPayload(null), null);
    assert.equal(extractUserIdentifierFromPayload(undefined), null);
  });

  await t.test("2. GET /api/v1/users/me/qr returns canonical HTTPS shareable URL and deepLink", async () => {
    const res = await request(app)
      .get("/api/v1/users/me/qr")
      .set("Cookie", bob.cookies);

    assert.equal(res.status, 200);
    assert.ok(res.body.data.qrCode.startsWith("data:image/png;base64,"));
    assert.ok(res.body.data.shareUrl.includes("/user/bob_deep"));
    assert.equal(res.body.data.deepLink, "chatty://user/bob_deep");
    assert.equal(res.body.data.payload, res.body.data.shareUrl);
  });

  await t.test("3. POST /api/v1/users/resolve-qr resolves canonical HTTPS URL", async () => {
    const res = await request(app)
      .post("/api/v1/users/resolve-qr")
      .set("Cookie", alice.cookies)
      .send({ payload: "https://chatty-app-sigma.vercel.app/user/bob_deep" });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.username, "bob_deep");
    assert.equal(res.body.data.relationship, "none");
    assert.ok(res.body.data.shareUrl.includes("/user/bob_deep"));
    assert.equal(res.body.data.deepLink, "chatty://user/bob_deep");
  });

  await t.test("4. POST /api/v1/users/resolve-qr resolves legacy chatty:// link", async () => {
    const res = await request(app)
      .post("/api/v1/users/resolve-qr")
      .set("Cookie", alice.cookies)
      .send({ payload: "chatty://user/bob_deep" });

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.username, "bob_deep");
  });

  await t.test("5. POST /api/v1/users/resolve-qr resolves @username and plain username", async () => {
    const resWithAt = await request(app)
      .post("/api/v1/users/resolve-qr")
      .set("Cookie", alice.cookies)
      .send({ payload: "@bob_deep" });

    assert.equal(resWithAt.status, 200);
    assert.equal(resWithAt.body.data.user.username, "bob_deep");

    const resPlain = await request(app)
      .post("/api/v1/users/resolve-qr")
      .set("Cookie", alice.cookies)
      .send({ payload: "bob_deep" });

    assert.equal(resPlain.status, 200);
    assert.equal(resPlain.body.data.user.username, "bob_deep");
  });

  await t.test("6. POST /api/v1/users/resolve-qr handles invalid or unknown user gracefully", async () => {
    const resNotFound = await request(app)
      .post("/api/v1/users/resolve-qr")
      .set("Cookie", alice.cookies)
      .send({ payload: "chatty://user/non_existent_user_99999" });

    assert.equal(resNotFound.status, 404);

    const resEmpty = await request(app)
      .post("/api/v1/users/resolve-qr")
      .set("Cookie", alice.cookies)
      .send({ payload: "" });

    assert.equal(resEmpty.status, 400);
  });

  await t.test("7. GET /api/v1/users/:id/profile resolves by username as well as ObjectId", async () => {
    const res = await request(app)
      .get("/api/v1/users/bob_deep/profile")
      .set("Cookie", alice.cookies);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.username, "bob_deep");
  });
});
