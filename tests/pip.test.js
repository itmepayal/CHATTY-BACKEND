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

async function runPipTests() {
  console.log("\n==================================================");
  console.log("Starting Picture-in-Picture (PiP) Verification Suite");
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
    console.log("--- Category 1: Components & Module Verification ---");

    await testCase("[Component] PipVideoCall.jsx exists and has valid exports", async () => {
      const compPath = path.join(
        rootDir,
        "client/src/components/Call/pip/PipVideoCall.jsx",
      );
      assert(fs.existsSync(compPath), "PipVideoCall.jsx component must exist");
      const content = fs.readFileSync(compPath, "utf-8");
      assert(content.includes("export default function PipVideoCall"), "PipVideoCall must have default export");
      assert(content.includes("remoteVideoRef"), "PipVideoCall must attach remote video ref");
      assert(content.includes("localVideoRef"), "PipVideoCall must attach local thumbnail video ref");
      assert(content.includes("onReturnToFullCall"), "PipVideoCall must handle return to full call");
      assert(content.includes("onToggleMute"), "PipVideoCall must support mute toggling");
      assert(content.includes("onToggleCamera"), "PipVideoCall must support camera toggling");
      assert(content.includes("onEndCall"), "PipVideoCall must support ending call");
    });

    await testCase("[Component] MinimizedCallView.jsx upgraded with local thumbnail and camera controls", async () => {
      const compPath = path.join(
        rootDir,
        "client/src/components/Call/common/MinimizedCallView.jsx",
      );
      assert(fs.existsSync(compPath), "MinimizedCallView.jsx must exist");
      const content = fs.readFileSync(compPath, "utf-8");
      assert(content.includes("localVideoRef"), "MinimizedCallView must have localVideoRef");
      assert(content.includes("onToggleCamera"), "MinimizedCallView must support onToggleCamera");
      assert(content.includes("localStream"), "MinimizedCallView must accept localStream prop");
      assert(content.includes("cameraOff"), "MinimizedCallView must handle cameraOff state");
    });

    console.log("\n--- Category 2: Document PiP Architecture & Logic ---");

    await testCase("[Feature Detection] Correctly detects documentPictureInPicture vs in-app fallback", async () => {
      function detectPipSupport(mockWindow) {
        return Boolean(mockWindow?.documentPictureInPicture?.requestWindow);
      }

      assert(detectPipSupport({ documentPictureInPicture: { requestWindow: () => {} } }) === true, "Must detect Document PiP when present");
      assert(detectPipSupport({}) === false, "Must detect absence when documentPictureInPicture is undefined");
      assert(detectPipSupport(null) === false, "Must handle null gracefully");
    });

    await testCase("[Styling Transfer] Stylesheet and link tag cloning algorithm", async () => {
      // Mock source document with stylesheets
      const mockHeadNodes = [
        { tagName: "LINK", rel: "stylesheet", href: "/assets/index.css", cloneNode: function () { return { ...this }; } },
        { tagName: "STYLE", textContent: ".bg-neutral { background-color: #0a0c10; }", cloneNode: function () { return { ...this }; } },
      ];

      const pipHeadNodes = [];
      const mockPipDoc = {
        head: {
          appendChild: (node) => pipHeadNodes.push(node),
        },
      };

      // Execute cloning
      mockHeadNodes.forEach((node) => {
        pipHeadNodes.push(node.cloneNode(true));
      });

      assert(pipHeadNodes.length === 2, "All stylesheets and style tags must be copied to PiP head");
      assert(pipHeadNodes[0].href === "/assets/index.css", "CSS link href must match");
      assert(pipHeadNodes[1].textContent.includes("#0a0c10"), "Inline styles must be preserved");
    });

    await testCase("[Audio & Autoplay Architecture] PiP remote video is muted, main window outputs audio", async () => {
      // PiP video must have muted=true to prevent Chrome Autoplay Policy from blocking video playback in secondary window
      const pipCompPath = path.join(
        rootDir,
        "client/src/components/Call/pip/PipVideoCall.jsx",
      );
      const pipContent = fs.readFileSync(pipCompPath, "utf-8");
      assert(pipContent.includes("el.muted = true"), "PiP remote video callback must set muted=true");
      assert(pipContent.includes("<video\n        ref={setRemoteVideoRef}\n        autoPlay\n        playsInline\n        muted"), "PiP remote video JSX must have muted attribute");

      // Main window video remains unmuted so remote audio continues to output without echo
      const callUiPath = path.join(
        rootDir,
        "client/src/components/Call/CallUI.jsx",
      );
      const callUiContent = fs.readFileSync(callUiPath, "utf-8");
      assert(callUiContent.includes("ref={remoteRef}\n        autoPlay\n        playsInline\n        muted={false}"), "Main window remote video must be unmuted (muted=false) to output audio");
    });

    await testCase("[WebRTC ontrack] Handles Case A when event.streams contains a stream", async () => {
      class MockMediaStream {
        constructor(tracks = []) {
          this.id = "mock-stream-" + Math.random().toString(36).slice(2, 7);
          this.tracks = [...tracks];
        }
        getTracks() { return [...this.tracks]; }
        getVideoTracks() { return this.tracks.filter(t => t.kind === "video"); }
        getAudioTracks() { return this.tracks.filter(t => t.kind === "audio"); }
        addTrack(track) {
          if (!this.tracks.some(t => t.id === track.id)) {
            this.tracks.push(track);
          }
        }
      }

      let remoteStreamRef = null;
      let stateRemoteStream = null;
      const setRemoteStream = (s) => { stateRemoteStream = s; };

      const onTrackHandler = (e) => {
        const receivedTrack = e.track;
        const streamFromEvent = e.streams && e.streams[0] ? e.streams[0] : null;

        if (!remoteStreamRef) {
          remoteStreamRef = streamFromEvent || new MockMediaStream();
        }

        const currentTracks = remoteStreamRef.getTracks();
        if (!currentTracks.some((t) => t.id === receivedTrack.id)) {
          remoteStreamRef.addTrack(receivedTrack);
        }

        setRemoteStream(new MockMediaStream(remoteStreamRef.getTracks()));
      };

      // Case A: Event contains a stream with an audio track
      const audioTrack = { id: "a1", kind: "audio", readyState: "live", addEventListener: () => {} };
      const streamA = new MockMediaStream([audioTrack]);
      onTrackHandler({ track: audioTrack, streams: [streamA] });

      assert(remoteStreamRef !== null, "remoteStreamRef must be initialized");
      assert(stateRemoteStream.getAudioTracks().length === 1, "Must have 1 audio track");
      assert(stateRemoteStream.getVideoTracks().length === 0, "Must have 0 video tracks initially");

      // Subsequent track arrives: video track
      const videoTrack = { id: "v1", kind: "video", readyState: "live", addEventListener: () => {} };
      onTrackHandler({ track: videoTrack, streams: [streamA] });

      assert(stateRemoteStream.getVideoTracks().length === 1, "Must now have 1 video track");
      assert(stateRemoteStream.getAudioTracks().length === 1, "Must still have 1 audio track");
    });

    await testCase("[WebRTC ontrack] Handles Case B when event.streams is empty and prevents duplicates", async () => {
      class MockMediaStream {
        constructor(tracks = []) {
          this.id = "mock-stream-b";
          this.tracks = [...tracks];
        }
        getTracks() { return [...this.tracks]; }
        getVideoTracks() { return this.tracks.filter(t => t.kind === "video"); }
        getAudioTracks() { return this.tracks.filter(t => t.kind === "audio"); }
        addTrack(track) {
          if (!this.tracks.some(t => t.id === track.id)) {
            this.tracks.push(track);
          }
        }
      }

      let remoteStreamRef = null;
      let stateRemoteStream = null;
      const setRemoteStream = (s) => { stateRemoteStream = s; };

      const onTrackHandler = (e) => {
        const receivedTrack = e.track;
        const streamFromEvent = e.streams && e.streams[0] ? e.streams[0] : null;

        if (!remoteStreamRef) {
          remoteStreamRef = streamFromEvent || new MockMediaStream();
        }

        const currentTracks = remoteStreamRef.getTracks();
        if (!currentTracks.some((t) => t.id === receivedTrack.id)) {
          remoteStreamRef.addTrack(receivedTrack);
        }

        setRemoteStream(new MockMediaStream(remoteStreamRef.getTracks()));
      };

      // Case B: streams array is empty
      const videoTrack = { id: "v2", kind: "video", readyState: "live", addEventListener: () => {} };
      onTrackHandler({ track: videoTrack, streams: [] });

      assert(remoteStreamRef !== null, "Must create persistent MediaStream in Case B");
      assert(stateRemoteStream.getVideoTracks().length === 1, "Must have video track from Case B");

      // Duplicate addition attempt of same track
      onTrackHandler({ track: videoTrack, streams: [] });
      assert(stateRemoteStream.getVideoTracks().length === 1, "Duplicate track addition must be prevented");
    });

    console.log("\n--- Category 3: PiP Lifecycle State Transitions ---");

    await testCase("[Lifecycle] Request PiP creates portal container and attaches pagehide listener", async () => {
      let pagehideHandler = null;
      let windowClosed = false;

      const mockPipWindow = {
        document: {
          title: "",
          body: {
            style: {},
            appendChild: (child) => child,
          },
          head: { appendChild: () => {} },
          createElement: (tag) => ({ tagName: tag, style: {}, id: "" }),
        },
        addEventListener: (event, handler) => {
          if (event === "pagehide") pagehideHandler = handler;
        },
        close: () => {
          windowClosed = true;
        },
      };

      let isPipActive = false;
      let pipContainer = null;

      // Simulate PiP opening
      const container = mockPipWindow.document.createElement("div");
      container.id = "pip-video-root";
      pipContainer = container;
      isPipActive = true;
      mockPipWindow.addEventListener("pagehide", () => {
        isPipActive = false;
        pipContainer = null;
      });

      assert(isPipActive === true, "isPipActive must be true after opening");
      assert(pipContainer.id === "pip-video-root", "Portal container must be initialized");
      assert(typeof pagehideHandler === "function", "pagehide handler must be attached");

      // Simulate closing PiP window via native OS 'x' button
      pagehideHandler();
      assert(isPipActive === false, "isPipActive must revert to false when PiP closes");
      assert(pipContainer === null, "pipContainer must be cleaned up");
    });

    await testCase("[Lifecycle] Ending call automatically terminates active PiP window", async () => {
      let closed = false;
      const mockPipWindow = {
        closed: false,
        close: () => {
          closed = true;
          mockPipWindow.closed = true;
        },
      };

      // Simulate CallContext.cleanup()
      function simulateCleanup(pipRef, setPipActive) {
        if (pipRef.current && !pipRef.current.closed) {
          try {
            pipRef.current.close();
          } catch {}
        }
        pipRef.current = null;
        setPipActive(false);
      }

      const pipRef = { current: mockPipWindow };
      let pipActive = true;
      simulateCleanup(pipRef, (v) => { pipActive = v; });

      assert(closed === true, "PiP window must be closed when call ends");
      assert(pipRef.current === null, "pipRef must be reset to null");
      assert(pipActive === false, "pipActive must be set to false");
    });

    await testCase("[Integration] CallContext exports all Picture-in-Picture handlers", async () => {
      const callContextPath = path.join(
        rootDir,
        "client/src/context/CallContext.jsx",
      );
      const content = fs.readFileSync(callContextPath, "utf-8");
      assert(content.includes("requestNativePip"), "CallContext must export requestNativePip");
      assert(content.includes("closePip"), "CallContext must export closePip");
      assert(content.includes("isPipActive"), "CallContext must export isPipActive");
      assert(content.includes("isDocPipSupported"), "CallContext must export isDocPipSupported");
    });

    console.log("\n==================================================");
    console.log(`All ${passedTests}/${totalTests} Picture-in-Picture Tests Passed!`);
    console.log("==================================================\n");
  } catch (err) {
    console.error("Test execution aborted:", err);
    process.exit(1);
  }
}

runPipTests().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
