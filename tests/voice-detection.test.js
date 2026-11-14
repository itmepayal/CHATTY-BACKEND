import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { detectVoiceMedia } from "../src/modules/messaging/services/attachments/message-attachment.service.js";

async function runVoiceTests() {
  console.log("Starting detectVoiceMedia tests...");
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

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "voice-test-"));

  try {
    // 1. Audio MIME types directly recognized
    await testCase("MIME audio/mp4 recognized", async () => {
      const res = await detectVoiceMedia({ mimetype: "audio/mp4", originalname: "voice.m4a" });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/mp4");
    });

    await testCase("MIME audio/x-m4a normalized to audio/mp4", async () => {
      const res = await detectVoiceMedia({ mimetype: "audio/x-m4a", originalname: "voice.m4a" });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/mp4");
    });

    await testCase("MIME audio/ogg recognized", async () => {
      const res = await detectVoiceMedia({ mimetype: "audio/ogg", originalname: "voice.ogg" });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/ogg");
    });

    await testCase("MIME audio/webm recognized", async () => {
      const res = await detectVoiceMedia({ mimetype: "audio/webm", originalname: "voice.webm" });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/webm");
    });

    // 2. M4A file with ftypM4A magic bytes but video/mp4 MIME (common mobile artifact)
    await testCase("M4A container with video/mp4 MIME identified via magic bytes", async () => {
      const filePath = path.join(tmpDir, "sample.m4a");
      // ftyp box with M4A brand
      const header = Buffer.from([
        0x00, 0x00, 0x00, 0x20, // size
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x4d, 0x34, 0x41, 0x20, // 'M4A '
        0x00, 0x00, 0x00, 0x00,
      ]);
      await fs.writeFile(filePath, header);

      const res = await detectVoiceMedia({
        path: filePath,
        mimetype: "video/mp4",
        originalname: "recorded-voice.m4a",
      });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/mp4");
    });

    // 3. Ogg container with OggS magic bytes
    await testCase("OGG container identified via OggS magic bytes", async () => {
      const filePath = path.join(tmpDir, "sample.ogg");
      const header = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0x00, 0x02]); // 'OggS'
      await fs.writeFile(filePath, header);

      const res = await detectVoiceMedia({
        path: filePath,
        mimetype: "application/octet-stream",
        originalname: "sample.ogg",
      });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/ogg");
    });

    // 4. MP3 with ID3 header
    await testCase("MP3 container identified via ID3 magic bytes", async () => {
      const filePath = path.join(tmpDir, "sample.mp3");
      const header = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]); // 'ID3'
      await fs.writeFile(filePath, header);

      const res = await detectVoiceMedia({
        path: filePath,
        mimetype: "application/octet-stream",
        originalname: "sample.mp3",
      });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/mpeg");
    });

    // 5. WAV container with RIFF...WAVE header
    await testCase("WAV container identified via RIFF WAVE magic bytes", async () => {
      const filePath = path.join(tmpDir, "sample.wav");
      const header = Buffer.from([
        0x52, 0x49, 0x46, 0x46, // RIFF
        0x24, 0x00, 0x00, 0x00, // size
        0x57, 0x41, 0x56, 0x45, // WAVE
      ]);
      await fs.writeFile(filePath, header);

      const res = await detectVoiceMedia({
        path: filePath,
        mimetype: "application/octet-stream",
        originalname: "sample.wav",
      });
      assert.strictEqual(res.isAudio, true);
      assert.strictEqual(res.mimeType, "audio/wav");
    });

    // 6. Non-audio file (e.g. PDF or MP4 video) rejected from voice
    await testCase("PDF file rejected from voice classification", async () => {
      const filePath = path.join(tmpDir, "sample.pdf");
      const header = Buffer.from("%PDF-1.5");
      await fs.writeFile(filePath, header);

      const res = await detectVoiceMedia({
        path: filePath,
        mimetype: "application/pdf",
        originalname: "doc.pdf",
      });
      assert.strictEqual(res.isAudio, false);
    });

    // 7. MP4 video file rejected from voice classification
    await testCase("Video MP4 (isom brand) with video/mp4 MIME rejected as voice", async () => {
      const filePath = path.join(tmpDir, "sample.mp4");
      const header = Buffer.from([
        0x00, 0x00, 0x00, 0x20, // size
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x69, 0x73, 0x6f, 0x6d, // 'isom'
        0x00, 0x00, 0x02, 0x00,
      ]);
      await fs.writeFile(filePath, header);

      const res = await detectVoiceMedia({
        path: filePath,
        mimetype: "video/mp4",
        originalname: "video.mp4",
      });
      assert.strictEqual(res.isAudio, false);
    });

  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  console.log(`\nTests finished: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runVoiceTests();
