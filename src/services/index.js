/**
 * Chatty Backend Services
 * Central barrel providing access to all domain service modules.
 */

import * as authService from "./auth/auth.service.js";
import * as passwordService from "./auth/password.service.js";
import * as tokenService from "./auth/token.service.js";
import * as sessionService from "./auth/session.service.js";
import * as twoFactorService from "./auth/twoFactor.service.js";
import * as accountService from "./auth/account.service.js";

import * as callService from "./calls/call.service.js";
import * as groupCallService from "./calls/group-call.service.js";
import * as contactService from "./contacts/contact.service.js";
import * as groupService from "./groups/group.service.js";
import * as groupMemberService from "./groups/group-member.service.js";
import * as groupMessageService from "./groups/group-message.service.js";
import * as groupKeyService from "./groups/group-key.service.js";
import * as groupShareService from "./groups/group-share.service.js";
import * as groupMediaService from "./groups/group-media.service.js";

import * as messagingService from "./messaging/index.js";
import * as privacyService from "./privacy/privacy.service.js";

import * as userProfileService from "./users/user-profile.service.js";
import * as userRelationService from "./users/user-relation.service.js";
import * as userSettingsService from "./users/user-settings.service.js";
import * as userKeyService from "./users/user-key.service.js";
import * as aiService from "./ai/ai.service.js";

export {
  authService,
  passwordService,
  tokenService,
  sessionService,
  twoFactorService,
  accountService,
  callService,
  groupCallService,
  contactService,
  groupService,
  groupMemberService,
  groupMessageService,
  groupKeyService,
  groupShareService,
  groupMediaService,
  messagingService,
  privacyService,
  userProfileService,
  userRelationService,
  userSettingsService,
  userKeyService,
  aiService,
};

const services = {
  authService,
  passwordService,
  tokenService,
  sessionService,
  twoFactorService,
  accountService,
  callService,
  groupCallService,
  contactService,
  groupService,
  groupMemberService,
  groupMessageService,
  groupKeyService,
  groupShareService,
  groupMediaService,
  messagingService,
  privacyService,
  userProfileService,
  userRelationService,
  userSettingsService,
  userKeyService,
  aiService,
};

export default services;
