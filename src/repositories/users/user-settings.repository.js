import User from "../../models/users.model.js";
import { toObjectId } from "../../utils/object-id.util.js";
import {
  PRIVACY_PROJECTION_FIELDS as PRIVACY_FIELDS,
  CHAT_PREF_PROJECTION_FIELDS as CHAT_PREF_FIELDS,
  APPEARANCE_PROJECTION_FIELDS as APPEARANCE_FIELDS,
} from "../../constants/privacy/privacy.constants.js";

export const findPrivacySettings = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select(PRIVACY_FIELDS);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updatePrivacySettings = async (
  userId,
  update,
  options = { new: true },
) => {
  const query = User.findByIdAndUpdate(toObjectId(userId), update, {
    new: true,
    runValidators: true,
    ...options,
  }).select(PRIVACY_FIELDS);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const findChatPreferences = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select(CHAT_PREF_FIELDS);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updateChatPreferences = async (
  userId,
  update,
  options = { new: true },
) => {
  const query = User.findByIdAndUpdate(toObjectId(userId), update, {
    new: true,
    runValidators: true,
    ...options,
  }).select(CHAT_PREF_FIELDS);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const findAppearanceSettings = async (userId, options = {}) => {
  const query = User.findById(toObjectId(userId)).select(APPEARANCE_FIELDS);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updateAppearanceSettings = async (
  userId,
  update,
  options = { new: true },
) => {
  const query = User.findByIdAndUpdate(toObjectId(userId), update, {
    new: true,
    runValidators: true,
    ...options,
  }).select(APPEARANCE_FIELDS);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

const userSettingsRepository = Object.freeze({
  findPrivacySettings,
  updatePrivacySettings,
  findChatPreferences,
  updateChatPreferences,
  findAppearanceSettings,
  updateAppearanceSettings,
});

export default userSettingsRepository;
