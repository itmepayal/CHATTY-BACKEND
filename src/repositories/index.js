// Auth domain
export * as authRepository from "./auth/auth.repository.js";
export * as sessionRepository from "./auth/session.repository.js";

// Users domain
export * as userRepository from "./users/user.repository.js";
export * as userKeyRepository from "./users/user-key.repository.js";
export * as userProfileRepository from "./users/user-profile.repository.js";
export * as userSettingsRepository from "./users/user-settings.repository.js";
export * as userRelationRepository from "./users/user-relation.repository.js";

// Contacts domain
export * as contactRepository from "./contacts/contact.repository.js";

// Messaging domain
export * as messageRepository from "./messaging/message.repository.js";
export * as chatSettingRepository from "./messaging/chat-setting.repository.js";
export * as scheduledMessageRepository from "./messaging/scheduled-message.repository.js";
export * as locationShareRepository from "./messaging/location-share.repository.js";
export * as reportRepository from "./messaging/report.repository.js";

// Groups domain
export * as groupRepository from "./groups/group.repository.js";
export * as groupMessageRepository from "./groups/group-message.repository.js";
export * as groupKeyRepository from "./groups/group-key.repository.js";
export * as groupArchiveRepository from "./groups/group-archive.repository.js";
export * as groupCallRepository from "./calling/group-call.repository.js";

// Calling domain
export * as callRepository from "./calling/call.repository.js";

// Privacy domain
export * as privacyRepository from "./privacy/privacy.repository.js";

// Default exports for backwards compatibility
export { default as authRepositoryDefault } from "./auth/auth.repository.js";
export { default as sessionRepositoryDefault } from "./auth/session.repository.js";
export { default as userRepositoryDefault } from "./users/user.repository.js";
export { default as userKeyRepositoryDefault } from "./users/user-key.repository.js";
export { default as userProfileRepositoryDefault } from "./users/user-profile.repository.js";
export { default as userSettingsRepositoryDefault } from "./users/user-settings.repository.js";
export { default as userRelationRepositoryDefault } from "./users/user-relation.repository.js";
export { default as contactRepositoryDefault } from "./contacts/contact.repository.js";
export { default as messageRepositoryDefault } from "./messaging/message.repository.js";
export { default as chatSettingRepositoryDefault } from "./messaging/chat-setting.repository.js";
export { default as scheduledMessageRepositoryDefault } from "./messaging/scheduled-message.repository.js";
export { default as locationShareRepositoryDefault } from "./messaging/location-share.repository.js";
export { default as reportRepositoryDefault } from "./messaging/report.repository.js";
export { default as groupRepositoryDefault } from "./groups/group.repository.js";
export { default as groupMessageRepositoryDefault } from "./groups/group-message.repository.js";
export { default as groupKeyRepositoryDefault } from "./groups/group-key.repository.js";
export { default as groupArchiveRepositoryDefault } from "./groups/group-archive.repository.js";
export { default as callRepositoryDefault } from "./calling/call.repository.js";
export { default as groupCallRepositoryDefault } from "./calling/group-call.repository.js";
export { default as privacyRepositoryDefault } from "./privacy/privacy.repository.js";

import authRepositoryInst from "./auth/auth.repository.js";
import sessionRepositoryInst from "./auth/session.repository.js";
import userRepositoryInst from "./users/user.repository.js";
import userKeyRepositoryInst from "./users/user-key.repository.js";
import userProfileRepositoryInst from "./users/user-profile.repository.js";
import userSettingsRepositoryInst from "./users/user-settings.repository.js";
import userRelationRepositoryInst from "./users/user-relation.repository.js";
import contactRepositoryInst from "./contacts/contact.repository.js";
import messageRepositoryInst from "./messaging/message.repository.js";
import chatSettingRepositoryInst from "./messaging/chat-setting.repository.js";
import scheduledMessageRepositoryInst from "./messaging/scheduled-message.repository.js";
import locationShareRepositoryInst from "./messaging/location-share.repository.js";
import reportRepositoryInst from "./messaging/report.repository.js";
import groupRepositoryInst from "./groups/group.repository.js";
import groupMessageRepositoryInst from "./groups/group-message.repository.js";
import groupKeyRepositoryInst from "./groups/group-key.repository.js";
import groupArchiveRepositoryInst from "./groups/group-archive.repository.js";
import callRepositoryInst from "./calling/call.repository.js";
import groupCallRepositoryInst from "./calling/group-call.repository.js";
import privacyRepositoryInst from "./privacy/privacy.repository.js";

const repositories = Object.freeze({
  auth: authRepositoryInst,
  session: sessionRepositoryInst,
  user: userRepositoryInst,
  userKey: userKeyRepositoryInst,
  userProfile: userProfileRepositoryInst,
  userSettings: userSettingsRepositoryInst,
  userRelation: userRelationRepositoryInst,
  contact: contactRepositoryInst,
  message: messageRepositoryInst,
  chatSetting: chatSettingRepositoryInst,
  scheduledMessage: scheduledMessageRepositoryInst,
  locationShare: locationShareRepositoryInst,
  report: reportRepositoryInst,
  group: groupRepositoryInst,
  groupMessage: groupMessageRepositoryInst,
  groupKey: groupKeyRepositoryInst,
  groupArchive: groupArchiveRepositoryInst,
  call: callRepositoryInst,
  groupCall: groupCallRepositoryInst,
  privacy: privacyRepositoryInst,
});

export default repositories;
