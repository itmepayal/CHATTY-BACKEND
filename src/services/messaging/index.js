/**
 * Messaging Services Aggregator
 * Exposes all 1:1 and conversation management domain services.
 */

import * as chatSettingService from "./settings/chat-setting.service.js";
import * as reportService from "./reports/message-report.service.js";
import * as scheduleService from "./scheduling/message-schedule.service.js";
import * as locationService from "./location/message-location.service.js";
import * as queryService from "./querying/message-query.service.js";
import * as lifecycleService from "./delivery/message-lifecycle.service.js";
import * as forwardService from "./sending/message-forward.service.js";
import * as deliveryService from "./delivery/message-delivery.service.js";
import * as sendService from "./sending/message-send.service.js";
import * as sidebarService from "./querying/sidebar.service.js";
import * as e2eeService from "./security/message-e2ee.service.js";
import * as spamService from "./security/message-spam.service.js";
import * as attachmentService from "./attachments/message-attachment.service.js";

export {
  chatSettingService,
  reportService,
  scheduleService,
  locationService,
  queryService,
  lifecycleService,
  forwardService,
  deliveryService,
  sendService,
  sidebarService,
  e2eeService,
  spamService,
  attachmentService,
};

const messagingServices = {
  chatSettingService,
  reportService,
  scheduleService,
  locationService,
  queryService,
  lifecycleService,
  forwardService,
  deliveryService,
  sendService,
  sidebarService,
  e2eeService,
  spamService,
  attachmentService,
};

export default messagingServices;
