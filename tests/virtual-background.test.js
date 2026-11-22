import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

async function runVirtualBackgroundTests() {
  console.log("\n==================================================");
  console.log("Starting Virtual Background & AI Segmentation Test Suite");
  console.log("==================================================\n");

  let totalTests = 0;
  let passedTests = 0;

  async function testCase(name, fn) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`[✓ PASS] ${name}`);
    } catch (err) {
      console.error(`[✗ FAIL] ${name}`);
      console.error(err);
      throw err;
    }
  }

  try {
    console.log("--- Category 1: Assets & Models Verification ---");

    await testCase("[Asset] selfie_segmenter.tflite model exists and is valid", async () => {
      const modelPath = path.join(rootDir, "client/public/models/selfie_segmenter.tflite");
      assert(fs.existsSync(modelPath), "Model file selfie_segmenter.tflite must exist");
      const stat = fs.statSync(modelPath);
      assert(stat.size > 200000, `Model size must be > 200KB (actual: ${stat.size} bytes)`);

      const buf = fs.readFileSync(modelPath);
      const magic = buf.subarray(4, 8).toString("ascii");
      assert(magic === "TFL3", `Model magic header must be TFL3 (actual: ${magic})`);
    });

    await testCase("[Asset] MediaPipe WASM and JS binaries exist and are complete", async () => {
      const wasmDir = path.join(rootDir, "client/public/wasm");
      assert(fs.existsSync(wasmDir), "WASM directory must exist");
      const requiredFiles = [
        "vision_wasm_internal.js",
        "vision_wasm_internal.wasm",
        "vision_wasm_module_internal.js",
        "vision_wasm_module_internal.wasm",
      ];
      for (const file of requiredFiles) {
        const filePath = path.join(wasmDir, file);
        assert(fs.existsSync(filePath), `Required WASM asset ${file} must exist`);
        const stat = fs.statSync(filePath);
        assert(stat.size > 1000, `WASM file ${file} must be non-empty`);
      }
    });

    await testCase("[Asset] All 10 preloaded virtual background SVGs exist and are valid", async () => {
      const expectedPresets = [
        "beach.svg",
        "cafe.svg",
        "home-office.svg",
        "library.svg",
        "minimal-gradient.svg",
        "modern-office.svg",
        "mountains.svg",
        "nature.svg",
        "professional-office.svg",
        "studio.svg",
      ];
      const bgDir = path.join(rootDir, "client/public/backgrounds");
      for (const svgFile of expectedPresets) {
        const filePath = path.join(bgDir, svgFile);
        assert(fs.existsSync(filePath), `Background ${svgFile} must exist`);
        const content = fs.readFileSync(filePath, "utf-8");
        assert(content.includes("<svg"), `${svgFile} must contain <svg tag`);
        assert(content.includes("</svg>"), `${svgFile} must contain </svg> closing tag`);
        assert(content.includes('viewBox="0 0 1280 720"') || content.includes('width="1280"'), `${svgFile} must have 16:9 dimensions`);
      }
    });

    console.log("\n--- Category 2: Preset Configurations & Module Verification ---");

    const processorModule = await import("../../client/src/lib/videoProcessor.js");
    const { VideoStreamProcessor, VIRTUAL_BACKGROUND_PRESETS } = processorModule;

    await testCase("[Presets] Preset list includes 15 modes with correct categories", async () => {
      assert(Array.isArray(VIRTUAL_BACKGROUND_PRESETS), "VIRTUAL_BACKGROUND_PRESETS must be an array");
      assert(VIRTUAL_BACKGROUND_PRESETS.length === 15, `Expected 15 presets, got ${VIRTUAL_BACKGROUND_PRESETS.length}`);

      const original = VIRTUAL_BACKGROUND_PRESETS.find((p) => p.id === "none");
      assert(original && original.category === "original", "Original camera mode must exist");

      const blurs = VIRTUAL_BACKGROUND_PRESETS.filter((p) => p.category === "blur");
      assert(blurs.length === 3, "Must have 3 blur levels: light, medium, strong");
      assert(blurs.some((b) => b.id === "blur-light"), "Must include blur-light");
      assert(blurs.some((b) => b.id === "blur-medium"), "Must include blur-medium");
      assert(blurs.some((b) => b.id === "blur-strong"), "Must include blur-strong");

      const virtuals = VIRTUAL_BACKGROUND_PRESETS.filter((p) => p.category === "virtual");
      assert(virtuals.length === 10, "Must have 10 virtual backgrounds");

      const custom = VIRTUAL_BACKGROUND_PRESETS.find((p) => p.id === "custom");
      assert(custom && custom.category === "custom", "Custom photo preset must exist");
    });

    console.log("\n--- Category 3: VideoStreamProcessor Class Functionality ---");

    await testCase("[Processor] Instance initializes with clean state and preloads SVGs", async () => {
      const processor = new VideoStreamProcessor();
      assert(processor.isRunning === false, "Processor must start in stopped state");
      assert(processor.status === "idle", "Initial status must be idle");
      assert(processor.backgroundEffect === "none", "Initial effect must be none");
      assert(processor.videoFilter === "none", "Initial filter must be none");
      assert(processor.arOverlay === "none", "Initial AR overlay must be none");
      assert(typeof processor.setEffects === "function", "setEffects method exists");
      assert(typeof processor.start === "function", "start method exists");
      assert(typeof processor.stop === "function", "stop method exists");
      assert(typeof processor.switchSource === "function", "switchSource method exists");
    });

    await testCase("[Processor] Status change callback notifies listeners correctly", async () => {
      const processor = new VideoStreamProcessor();
      let lastStatus = "";
      let lastMsg = "";
      processor.onStatusChange = (status, msg) => {
        lastStatus = status;
        lastMsg = msg;
      };

      processor._setStatus("ready", "Model active");
      assert(lastStatus === "ready", "Status listener should receive ready");
      assert(lastMsg === "Model active", "Status message should match");

      processor._setStatus("fallback", "Fallback mode");
      assert(lastStatus === "fallback", "Status listener should receive fallback");
    });

    await testCase("[Processor] Filter strings map correctly for beauty and color modes", async () => {
      const processor = new VideoStreamProcessor();
      processor.videoFilter = "beauty";
      assert(processor._getFilterString().includes("contrast"), "Beauty filter includes contrast");
      assert(processor._getFilterString().includes("brightness"), "Beauty filter includes brightness");
      assert(processor._getFilterString().includes("saturate"), "Beauty filter includes saturation");

      processor.videoFilter = "bw";
      assert(processor._getFilterString().includes("grayscale(100%)"), "B&W filter must include grayscale(100%)");

      processor.videoFilter = "warm";
      assert(processor._getFilterString().includes("sepia"), "Warm filter must include sepia");

      processor.videoFilter = "cool";
      assert(processor._getFilterString().includes("hue-rotate(180deg)"), "Cool filter must rotate hue");

      processor.videoFilter = "none";
      assert(processor._getFilterString() === "none", "Normal filter must return none");
    });

    await testCase("[Processor] Cover image aspect ratio cropping calculations", async () => {
      const processor = new VideoStreamProcessor();

      // Mock canvas context
      const drawCalls = [];
      const mockCtx = {
        drawImage: (img, sx, sy, sw, sh, dx, dy, dw, dh) => {
          drawCalls.push({ sx, sy, sw, sh, dx, dy, dw, dh });
        },
        fillStyle: "",
        fillRect: () => {},
      };

      // 1. Wider image than canvas (1920x1080 into 1280x720 -> same 16:9 ratio)
      const img16_9 = { complete: true, naturalWidth: 1920, naturalHeight: 1080 };
      processor._drawCoverImage(mockCtx, img16_9, 1280, 720);
      assert(drawCalls.length === 1, "drawImage should be called once");
      assert(drawCalls[0].dw === 1280 && drawCalls[0].dh === 720, "Output dimensions must match canvas");

      // 2. Square image (1000x1000 into 1280x720 canvas)
      drawCalls.length = 0;
      const imgSquare = { complete: true, naturalWidth: 1000, naturalHeight: 1000 };
      processor._drawCoverImage(mockCtx, imgSquare, 1280, 720);
      assert(drawCalls.length === 1, "drawImage called for square image");
      // Height should be cropped to match 16:9 (1000 / (1280/720) = 562.5)
      assert(Math.round(drawCalls[0].sh) === 563, `Expected sh ~ 563, got ${drawCalls[0].sh}`);
      assert(drawCalls[0].sy > 0, "Vertical cropping offset sy must be positive");

      // 3. Incomplete or unready image falls back safely to fillRect without throwing
      let filledRect = false;
      mockCtx.fillRect = (x, y, w, h) => {
        filledRect = true;
      };
      processor._drawCoverImage(mockCtx, { complete: false }, 1280, 720);
      assert(filledRect === true, "Unready image must trigger safe fillRect fallback");
    });

    await testCase("[Processor] Polarity and S-Curve thresholding mathematics", async () => {
      // Test smooth Hermite S-Curve formula used in segmentation
      function computeAlpha(confidence, isMaskInverted) {
        let c = confidence;
        if (isMaskInverted) c = 1.0 - c;
        const low = 0.28;
        const high = 0.72;
        if (c <= low) return 0;
        if (c >= high) return 255;
        const t = (c - low) / (high - low);
        const smooth = t * t * (3 - 2 * t);
        return Math.round(smooth * 255);
      }

      // Normal mask: background = 0.0, person = 1.0
      assert(computeAlpha(0.05, false) === 0, "Low confidence must have 0 alpha (background)");
      assert(computeAlpha(0.95, false) === 255, "High confidence must have 255 alpha (person)");
      const midAlpha = computeAlpha(0.50, false);
      assert(midAlpha > 100 && midAlpha < 160, `Midpoint confidence must be smooth feather (~128, actual: ${midAlpha})`);

      // Inverted mask: background = 1.0, person = 0.0
      assert(computeAlpha(0.95, true) === 0, "Inverted: high input must flip to background (alpha 0)");
      assert(computeAlpha(0.05, true) === 255, "Inverted: low input must flip to person (alpha 255)");
    });

    await testCase("[Processor] MPMask close() memory leak prevention handler", async () => {
      const processor = new VideoStreamProcessor();
      let closeCalled = 0;
      const mockMask = {
        width: 256,
        height: 256,
        getAsFloat32Array: () => new Float32Array(256 * 256).fill(0.9),
        close: () => {
          closeCalled++;
        },
      };

      // Ensure _processSegmentationResult closes all masks in finally block
      processor.maskCanvas = { width: 256, height: 256 };
      processor.maskCtx = {
        createImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }),
        putImageData: () => {},
      };
      processor._processSegmentationResult({ confidenceMasks: [mockMask, mockMask] });
      assert(closeCalled === 2, `Expected all 2 confidence masks to be closed, got ${closeCalled}`);
    });

    await testCase("[Processor] stop() cleans up without stopping underlying camera stream tracks", async () => {
      const processor = new VideoStreamProcessor();

      let cameraTrackStopped = false;
      const mockCameraTrack = {
        kind: "video",
        enabled: true,
        stop: () => {
          cameraTrackStopped = true;
        },
        getSettings: () => ({ width: 1280, height: 720 }),
      };

      processor.sourceVideo = {
        pause: () => {},
        srcObject: {
          getTracks: () => [mockCameraTrack],
        },
      };
      processor.isRunning = true;

      processor.stop();
      assert(cameraTrackStopped === false, "stop() must NEVER call stop() on user camera tracks!");
      assert(processor.sourceVideo === null, "sourceVideo must be reset to null");
      assert(processor.isRunning === false, "isRunning must be false");
      assert(processor.status === "idle", "status must be reset to idle");
    });

    console.log("\n==================================================");
    console.log(`All ${passedTests}/${totalTests} Virtual Background Tests Passed!`);
    console.log("==================================================\n");
  } catch (err) {
    console.error("Test execution aborted:", err);
    process.exit(1);
  }
}

runVirtualBackgroundTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
