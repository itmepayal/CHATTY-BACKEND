/**
 * Backward-compatible re-export shim for message services.
 * Real implementations live under src/services/messaging/
 */
export { deliverMessage } from "./messaging/message-delivery.service.js";
export { assertE2EEReady } from "./messaging/message-e2ee.service.js";
export { assertNotSpamming } from "./messaging/message-spam.service.js";
export { processAttachment } from "./messaging/message-attachment.service.js";
