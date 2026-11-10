import User from "../models/users.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const findProfileById = async (userId, options = {}) => {
  const projection =
    options.projection ||
    "_id fullName username email avatar phone gender dob location website bio status isOnline lastSeen createdAt";

  const query = User.findById(toObjectId(userId)).select(projection);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const existsUsernameExcept = async (username, userId, options = {}) => {
  const query = User.exists({
    username: String(username).toLowerCase(),
    _id: { $ne: toObjectId(userId) },
  });

  if (options.session) query.session(options.session);

  const found = await query;

  return Boolean(found);
};

export const updateProfileById = async (
  userId,
  update,
  options = { new: true },
) => {
  const query = User.findByIdAndUpdate(toObjectId(userId), update, {
    new: true,
    runValidators: true,
    ...options,
  });

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const updateAvatarById = async (
  userId,
  avatar,
  options = { new: true },
) => {
  const query = User.findByIdAndUpdate(
    toObjectId(userId),
    { $set: { avatar } },
    { new: true, runValidators: true, ...options },
  );

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

export const findUsersByIds = async (userIds, projection, options = {}) => {
  const query = User.find({ _id: { $in: userIds.map(toObjectId) } });

  if (projection) query.select(projection);

  if (options.session) query.session(options.session);

  return options.lean === false ? query : query.lean();
};

const userProfileRepository = Object.freeze({
  findProfileById,
  existsUsernameExcept,
  updateProfileById,
  updateAvatarById,
  findUsersByIds,
});

export default userProfileRepository;
