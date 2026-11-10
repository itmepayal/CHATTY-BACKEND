import User from "../../users/models/users.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const findByEmail = async (email, options = {}) => {
  if (!email) return null;
  const projection = typeof options === "string" ? options : options.projection;
  const query = User.findOne({ email: String(email).toLowerCase() });
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findDocumentByEmail = async (email, projection, options = {}) => {
  if (!email) return null;
  const query = User.findOne({ email: String(email).toLowerCase() });
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findDocumentById = async (userId, projection, options = {}) => {
  if (!userId) return null;
  const query = User.findById(toObjectId(userId));
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findById = async (userId, options = {}) => {
  if (!userId) return null;
  const projection = typeof options === "string" ? options : options.projection;
  const query = User.findById(toObjectId(userId));
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findByResetToken = async (hashedToken, options = {}) => {
  const query = User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: new Date() },
  }).select("+passwordResetToken +passwordResetExpires +tokenVersion");
  if (options.session) query.session(options.session);
  return options.lean ? query.lean() : query;
};

export const create = async (userData, options = {}) => {
  if (options.session) {
    const [user] = await User.create([userData], { session: options.session });
    return user;
  }
  return User.create(userData);
};

export const updateById = async (userId, update, options = { new: true }) => {
  const queryOpts = { new: true, runValidators: true, ...options };
  const query = User.findByIdAndUpdate(toObjectId(userId), update, queryOpts);
  if (options.session) query.session(options.session);
  return options.lean === false ? query : query.lean();
};

export const findUserByEmail = (email, projection) =>
  findByEmail(email, { projection, lean: true });
export const findUserDocumentByEmail = (email, projection) =>
  findDocumentByEmail(email, projection);
export const findUserDocumentById = (userId, projection) =>
  findDocumentById(userId, projection);
export const createUser = (userData, options) => create(userData, options);
export const updateUserById = (userId, update, options) =>
  updateById(userId, update, options);

const authRepository = Object.freeze({
  findByEmail,
  findDocumentByEmail,
  findDocumentById,
  findById,
  findByResetToken,
  create,
  updateById,
  findUserByEmail,
  findUserDocumentByEmail,
  findUserDocumentById,
  createUser,
  updateUserById,
});

export default authRepository;
