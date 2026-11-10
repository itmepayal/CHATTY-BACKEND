// Auth domain
export * as authRepository from "./auth/repositories/auth.repository.js";
export * as sessionRepository from "./auth/repositories/session.repository.js";

// Users domain
export * as userRepository from "./users/repositories/user.repository.js";
export * as userKeyRepository from "./users/repositories/user-key.repository.js";
export * as userProfileRepository from "./users/repositories/user-profile.repository.js";
export * as userSettingsRepository from "./users/repositories/user-settings.repository.js";
export * as userRelationRepository from "./users/repositories/user-relation.repository.js";

// Contacts domain
export * as contactRepository from "./contacts/repositories/contact.repository.js";

// Messaging domain
export * as messageRepository from "./messaging/repositories/message.repository.js";
export * as chatSettingRepository from "./messaging/repositories/chat-setting.repository.js";
export * as scheduledMessageRepository from "./messaging/repositories/scheduled-message.repository.js";
export * as locationShareRepository from "./messaging/repositories/location-share.repository.js";
export * as reportRepository from "./messaging/repositories/report.repository.js";

// Groups domain
export * as groupRepository from "./groups/repositories/group.repository.js";
export * as groupMessageRepository from "./groups/repositories/group-message.repository.js";
export * as groupKeyRepository from "./groups/repositories/group-key.repository.js";
export * as groupArchiveRepository from "./groups/repositories/group-archive.repository.js";
export * as groupCallRepository from "./calling/repositories/group-call.repository.js";

// Calling domain
export * as callRepository from "./calling/repositories/call.repository.js";

// Privacy domain
export * as privacyRepository from "./privacy/repositories/privacy.repository.js";

// Default exports for backwards compatibility
export { default as authRepositoryDefault } from "./auth/repositories/auth.repository.js";
export { default as sessionRepositoryDefault } from "./auth/repositories/session.repository.js";
export { default as userRepositoryDefault } from "./users/repositories/user.repository.js";
export { default as userKeyRepositoryDefault } from "./users/repositories/user-key.repository.js";
export { default as userProfileRepositoryDefault } from "./users/repositories/user-profile.repository.js";
export { default as userSettingsRepositoryDefault } from "./users/repositories/user-settings.repository.js";
export { default as userRelationRepositoryDefault } from "./users/repositories/user-relation.repository.js";
export { default as contactRepositoryDefault } from "./contacts/repositories/contact.repository.js";
export { default as messageRepositoryDefault } from "./messaging/repositories/message.repository.js";
export { default as chatSettingRepositoryDefault } from "./messaging/repositories/chat-setting.repository.js";
export { default as scheduledMessageRepositoryDefault } from "./messaging/repositories/scheduled-message.repository.js";
export { default as locationShareRepositoryDefault } from "./messaging/repositories/location-share.repository.js";
export { default as reportRepositoryDefault } from "./messaging/repositories/report.repository.js";
export { default as groupRepositoryDefault } from "./groups/repositories/group.repository.js";
export { default as groupMessageRepositoryDefault } from "./groups/repositories/group-message.repository.js";
export { default as groupKeyRepositoryDefault } from "./groups/repositories/group-key.repository.js";
export { default as groupArchiveRepositoryDefault } from "./groups/repositories/group-archive.repository.js";
export { default as callRepositoryDefault } from "./calling/repositories/call.repository.js";
export { default as groupCallRepositoryDefault } from "./calling/repositories/group-call.repository.js";
export { default as privacyRepositoryDefault } from "./privacy/repositories/privacy.repository.js";

import authRepositoryInst from "./auth/repositories/auth.repository.js";
import sessionRepositoryInst from "./auth/repositories/session.repository.js";
import userRepositoryInst from "./users/repositories/user.repository.js";
import userKeyRepositoryInst from "./users/repositories/user-key.repository.js";
import userProfileRepositoryInst from "./users/repositories/user-profile.repository.js";
import userSettingsRepositoryInst from "./users/repositories/user-settings.repository.js";
import userRelationRepositoryInst from "./users/repositories/user-relation.repository.js";
import contactRepositoryInst from "./contacts/repositories/contact.repository.js";
import messageRepositoryInst from "./messaging/repositories/message.repository.js";
import chatSettingRepositoryInst from "./messaging/repositories/chat-setting.repository.js";
import scheduledMessageRepositoryInst from "./messaging/repositories/scheduled-message.repository.js";
import locationShareRepositoryInst from "./messaging/repositories/location-share.repository.js";
import reportRepositoryInst from "./messaging/repositories/report.repository.js";
import groupRepositoryInst from "./groups/repositories/group.repository.js";
import groupMessageRepositoryInst from "./groups/repositories/group-message.repository.js";
import groupKeyRepositoryInst from "./groups/repositories/group-key.repository.js";
import groupArchiveRepositoryInst from "./groups/repositories/group-archive.repository.js";
import callRepositoryInst from "./calling/repositories/call.repository.js";
import groupCallRepositoryInst from "./calling/repositories/group-call.repository.js";
import privacyRepositoryInst from "./privacy/repositories/privacy.repository.js";

export default {
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
};
