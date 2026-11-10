import { CALL_LIMITS } from "../constants/call.constants.js";

/**
 * Validates a WebRTC Session Description (offer or answer).
 * Protects against malformed, oversized, or prototype-polluting SDP payloads.
 */
export const validateSdp = (desc, expectedType = null) => {
  if (!desc || typeof desc !== "object") return null;
  const { type, sdp } = desc;

  if (type !== "offer" && type !== "answer") return null;
  if (expectedType && type !== expectedType) return null;
  if (typeof sdp !== "string" || !sdp.trim()) return null;
  if (sdp.length > CALL_LIMITS.MAX_SDP_SIZE) return null;

  return { type, sdp: sdp.trim() };
};

/**
 * Validates a WebRTC ICE Candidate object or string.
 * Ensures the candidate is well-formed and bounded in size.
 */
export const validateIceCandidate = (cand) => {
  if (!cand) return null;

  // Handle string candidate directly
  if (typeof cand === "string") {
    const trimmed = cand.trim();
    if (!trimmed || trimmed.length > CALL_LIMITS.MAX_CANDIDATE_SIZE) return null;
    return { candidate: trimmed, sdpMid: null, sdpMLineIndex: null };
  }

  // Handle standard RTCIceCandidateInit object
  if (typeof cand === "object" && cand !== null && !Array.isArray(cand)) {
    const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = cand;

    // Disallow empty object {} with no fields
    if (
      (candidate === undefined || candidate === null) &&
      (sdpMid === undefined || sdpMid === null) &&
      (sdpMLineIndex === undefined || sdpMLineIndex === null)
    ) {
      return null;
    }

    if (candidate !== undefined && candidate !== null) {
      if (
        typeof candidate !== "string" ||
        candidate.length > CALL_LIMITS.MAX_CANDIDATE_SIZE
      ) {
        return null;
      }
    }

    if (sdpMid !== undefined && sdpMid !== null) {
      if (typeof sdpMid !== "string" || sdpMid.length > 256) return null;
    }

    if (sdpMLineIndex !== undefined && sdpMLineIndex !== null) {
      if (
        !Number.isInteger(sdpMLineIndex) ||
        sdpMLineIndex < 0 ||
        sdpMLineIndex > 65535
      ) {
        return null;
      }
    }

    return {
      candidate: typeof candidate === "string" ? candidate : "",
      sdpMid: typeof sdpMid === "string" ? sdpMid : null,
      sdpMLineIndex:
        sdpMLineIndex !== undefined && sdpMLineIndex !== null
          ? Number(sdpMLineIndex)
          : null,
      ...(typeof usernameFragment === "string"
        ? { usernameFragment: usernameFragment.slice(0, 128) }
        : {}),
    };
  }

  return null;
};

/**
 * Validates media track status payload ({ audio, video }).
 */
export const validateMediaPayload = (payload) => {
  if (!payload || typeof payload !== "object") {
    return { audio: true, video: true };
  }
  return {
    audio: Boolean(payload.audio),
    video: Boolean(payload.video),
  };
};
