import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { setupTestEnvironment, teardownTestEnvironment } from "./test-env.js";
import { createAndLoginUsers } from "./auth-helper.js";
import Contact from "../src/modules/contacts/models/contact.model.js";
import Story from "../src/modules/stories/models/story.model.js";
import Message from "../src/modules/messaging/models/message.model.js";

test("Complete Stories & Status System Test Suite", async (t) => {
  const env = await setupTestEnvironment();
  const { app, port } = env;

  const users = await createAndLoginUsers(app, port, { makeContacts: false });
  const { alice, bob, charlie, david } = users;

  const aliceId = String(alice.user._id);
  const bobId = String(bob.user._id);
  const charlieId = String(charlie.user._id);
  const davidId = String(david.user._id);

  // Set Alice and Bob as mutual contacts
  await Contact.create({ ownerId: aliceId, contactId: bobId });
  await Contact.create({ ownerId: bobId, contactId: aliceId });

  let textStoryId;
  let customStoryId;

  await t.test("1. Create Text Status Story", async () => {
    const res = await request(app)
      .post("/api/v1/stories")
      .set("Cookie", alice.cookies)
      .send({
        mediaType: "text",
        textContent: "Hello from Alice's 24-hour status! ✨",
        background: JSON.stringify({
          type: "gradient",
          value: "linear-gradient(135deg, #ec4899, #8b5cf6)",
          textColor: "#ffffff",
          font: "sans",
        }),
        privacy: "contacts",
      })
      .expect(201);

    assert.ok(res.body?.success);
    assert.equal(res.body.data.mediaType, "text");
    assert.equal(res.body.data.textContent, "Hello from Alice's 24-hour status! ✨");
    assert.equal(res.body.data.privacy, "contacts");
    assert.ok(res.body.data.expiresAt);

    // Verify expiration is set approx 24 hours into future
    const exp = new Date(res.body.data.expiresAt).getTime();
    const diffHours = (exp - Date.now()) / (1000 * 60 * 60);
    assert.ok(diffHours > 23.5 && diffHours <= 24.1, "Expiration must be within ~24 hours");

    textStoryId = res.body.data._id;
  });

  await t.test("2. Privacy Filtering in Story Feed & Blocked Users", async () => {
    // Charlie is not a contact of Alice, so Charlie should not see Alice's "contacts" story
    const charlieFeed = await request(app)
      .get("/api/v1/stories/feed")
      .set("Cookie", charlie.cookies)
      .expect(200);

    assert.ok(charlieFeed.body?.success);
    const charlieStoriesFromAlice = charlieFeed.body.data.find(
      (group) => group.user?._id === aliceId
    );
    assert.equal(charlieStoriesFromAlice, undefined, "Charlie should not see Alice's contact-only story");

    // Bob IS an accepted contact of Alice, so Bob should see Alice's story
    const bobFeed = await request(app)
      .get("/api/v1/stories/feed")
      .set("Cookie", bob.cookies)
      .expect(200);

    assert.ok(bobFeed.body?.success);
    const bobStoriesFromAlice = bobFeed.body.data.find(
      (group) => group.user?._id === aliceId
    );
    assert.ok(bobStoriesFromAlice, "Bob should see Alice's story group");
    assert.equal(bobStoriesFromAlice.stories.length, 1);
    assert.equal(bobStoriesFromAlice.stories[0]._id, textStoryId);

    // David is blocked by Alice, so even if story was "everyone", David cannot see it
    const everyoneStory = await Story.create({
      userId: aliceId,
      mediaType: "text",
      textContent: "Public announcement!",
      privacy: "everyone",
    });

    const davidFeed = await request(app)
      .get("/api/v1/stories/feed")
      .set("Cookie", david.cookies)
      .expect(200);

    const davidSawStory = davidFeed.body.data.some((g) => g.user?._id === aliceId);
    assert.equal(davidSawStory, false, "Blocked user David should never see Alice's stories");

    await Story.findByIdAndDelete(everyoneStory._id);
  });

  await t.test("3. Custom Privacy (Only allowedViewers)", async () => {
    // Alice creates a story visible only to Charlie
    const res = await request(app)
      .post("/api/v1/stories")
      .set("Cookie", alice.cookies)
      .send({
        mediaType: "text",
        textContent: "Special story only for Charlie!",
        privacy: "custom",
        allowedViewers: JSON.stringify([charlieId]),
      })
      .expect(201);

    customStoryId = res.body.data._id;

    // Bob shouldn't see it
    const bobStories = await request(app)
      .get(`/api/v1/stories/user/${aliceId}`)
      .set("Cookie", bob.cookies)
      .expect(200);

    const bobCanSeeCustom = bobStories.body.data.some((s) => s._id === customStoryId);
    assert.equal(bobCanSeeCustom, false, "Bob should not see custom story intended for Charlie");

    // Charlie should see it
    const charlieStories = await request(app)
      .get(`/api/v1/stories/user/${aliceId}`)
      .set("Cookie", charlie.cookies)
      .expect(200);

    const charlieCanSeeCustom = charlieStories.body.data.some((s) => s._id === customStoryId);
    assert.equal(charlieCanSeeCustom, true, "Charlie should see custom story");
  });

  await t.test("4. Record Story View & Duplicate Prevention", async () => {
    // Bob views Alice's text story
    const res1 = await request(app)
      .post(`/api/v1/stories/${textStoryId}/view`)
      .set("Cookie", bob.cookies)
      .expect(200);

    assert.ok(res1.body?.success);
    assert.equal(res1.body.data.alreadyViewed, false);
    assert.equal(res1.body.data.viewCount, 1);

    // Bob views it a second time: must NOT duplicate view
    const res2 = await request(app)
      .post(`/api/v1/stories/${textStoryId}/view`)
      .set("Cookie", bob.cookies)
      .expect(200);

    assert.ok(res2.body?.success);
    assert.equal(res2.body.data.alreadyViewed, true);
    assert.equal(res2.body.data.viewCount, 1);
  });

  await t.test("5. React to Story", async () => {
    // Bob reacts with 🔥
    const res = await request(app)
      .post(`/api/v1/stories/${textStoryId}/react`)
      .set("Cookie", bob.cookies)
      .send({ emoji: "🔥" })
      .expect(200);

    assert.ok(res.body?.success);
    assert.equal(res.body.data.emoji, "🔥");

    // Check story in DB
    const story = await Story.findById(textStoryId);
    const bobView = story.views.find((v) => String(v.userId) === bobId);
    assert.ok(bobView);
    assert.equal(bobView.reaction, "🔥");
  });

  await t.test("6. Viewers List Access Control (Owner vs Non-Owner)", async () => {
    // Bob (not owner) tries to view Alice's story viewers -> Forbidden 403
    await request(app)
      .get(`/api/v1/stories/${textStoryId}/viewers`)
      .set("Cookie", bob.cookies)
      .expect(403);

    // Alice (owner) gets the viewers list -> 200 OK
    const res = await request(app)
      .get(`/api/v1/stories/${textStoryId}/viewers`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(res.body?.success);
    assert.equal(res.body.data.totalViews, 1);
    assert.equal(res.body.data.viewers[0].user._id, bobId);
    assert.equal(res.body.data.viewers[0].reaction, "🔥");
  });

  await t.test("7. Reply to Story via 1:1 Direct Message", async () => {
    // Bob replies to Alice's story
    const res = await request(app)
      .post(`/api/v1/stories/${textStoryId}/reply`)
      .set("Cookie", bob.cookies)
      .send({ text: "Awesome status Alice! Looking great!" })
      .expect(200);

    assert.ok(res.body?.success);
    const messagePayload = res.body.data.payload;
    assert.ok(messagePayload);
    assert.equal(messagePayload.text, "Awesome status Alice! Looking great!");
    assert.equal(messagePayload.messageType, "story_reply");
    assert.ok(messagePayload.storyReply);
    assert.equal(messagePayload.storyReply.storyId, textStoryId);
    assert.equal(messagePayload.storyReply.storyTextContent, "Hello from Alice's 24-hour status! ✨");

    // Verify the message exists in the DB between Bob and Alice
    const msgInDb = await Message.findById(messagePayload.id);
    assert.ok(msgInDb);
    assert.equal(String(msgInDb.senderId), bobId);
    assert.equal(String(msgInDb.receiverId), aliceId);
    assert.equal(msgInDb.messageType, "story_reply");
  });

  await t.test("8. Story Management & Lifetime Countdown (GET /api/v1/stories/my)", async () => {
    // Alice requests her active stories
    const myRes = await request(app)
      .get("/api/v1/stories/my")
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(myRes.body?.success);
    const myStories = myRes.body.data;
    assert.ok(myStories.length > 0);
    const textStory = myStories.find((s) => s._id === textStoryId);
    assert.ok(textStory);
    assert.ok(textStory.remainingFormatted);
    assert.ok(textStory.remainingMs > 0);
    assert.equal(textStory.viewCount, 1);
    assert.equal(textStory.reactionCounts["🔥"], 1);
  });

  await t.test("9. Paginated Story Viewers", async () => {
    // Alice fetches viewers with limit=1
    const pRes = await request(app)
      .get(`/api/v1/stories/${textStoryId}/viewers?page=1&limit=1`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(pRes.body?.success);
    assert.equal(pRes.body.data.page, 1);
    assert.equal(pRes.body.data.limit, 1);
    assert.equal(pRes.body.data.viewers.length, 1);
    assert.equal(pRes.body.data.viewers[0].user._id, bobId);
  });

  await t.test("10. Story Expiration & Deletion", async () => {
    // Create an expired story manually in DB
    const expiredStory = await Story.create({
      userId: aliceId,
      mediaType: "text",
      textContent: "This story has expired",
      expiresAt: new Date(Date.now() - 1000), // 1 second ago
    });

    // Verify it is excluded from getStoryFeed
    const feed = await request(app)
      .get("/api/v1/stories/feed")
      .set("Cookie", alice.cookies)
      .expect(200);

    const allStoryIds = feed.body.data.flatMap((g) => g.stories.map((s) => s._id));
    assert.equal(allStoryIds.includes(String(expiredStory._id)), false, "Expired story must not be in feed");

    // Non-owner cannot delete Alice's story
    await request(app)
      .delete(`/api/v1/stories/${textStoryId}`)
      .set("Cookie", bob.cookies)
      .expect(403);

    // Alice deletes her story
    const delRes = await request(app)
      .delete(`/api/v1/stories/${textStoryId}`)
      .set("Cookie", alice.cookies)
      .expect(200);

    assert.ok(delRes.body?.success);

    const deletedFromDb = await Story.findById(textStoryId);
    assert.equal(deletedFromDb, null, "Deleted story must no longer exist in database");
  });

  t.after(async () => {
    await teardownTestEnvironment();
  });
});
