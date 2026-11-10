/**
 * Core Message Service Compatibility Barrel
 * Re-exports shared 1:1 message primitives used across jobs and messaging subdomains.
 */

import { deliverMessage } from "../delivery/message-delivery.service.js";
import { assertE2EEReady } from "../security/message-e2ee.service.js";
import { assertNotSpamming } from "../security/message-spam.service.js";
import { processAttachment } from "../attachments/message-attachment.service.js";

export { deliverMessage, assertE2EEReady, assertNotSpamming, processAttachment };

const coreMessageService = {
  deliverMessage,
  assertE2EEReady,
  assertNotSpamming,
  processAttachment,
};

export default coreMessageService;
