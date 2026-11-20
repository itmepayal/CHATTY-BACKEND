import { sweepAllDisappearingMessages } from "../services/disappearing/disappearing.service.js";
import { DISAPPEARING_SWEEP_INTERVAL_MS } from "../constants/messages.constants.js";

export const sweepDisappearingMessages = sweepAllDisappearingMessages;

let started = false;

export const startDisappearingSweeper = () => {
  if (started) return;
  started = true;

  setInterval(sweepDisappearingMessages, DISAPPEARING_SWEEP_INTERVAL_MS);
};

