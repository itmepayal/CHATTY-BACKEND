import User from "../../models/users.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export const findUserByEmail = async (email, projection) => {
  const query = User.findOne({ email: String(email).toLowerCase() });
  if (projection) query.select(projection);
  return query.lean();
};

export const findUserDocumentByEmail = async (email, projection) => {
  const query = User.findOne({ email: String(email).toLowerCase() });
  if (projection) query.select(projection);
  return query;
};

export const findUserDocumentById = async (userId, projection) => {
  const query = User.findById(toObjectId(userId));
  if (projection) query.select(projection);
  return query;
};

export const createUser = async (userData) => {
  return User.create(userData);
};

export const updateUserById = async (userId, update, options = { new: true }) => {
  return User.findByIdAndUpdate(toObjectId(userId), update, options).lean();
};

const authRepository = {
  findUserByEmail,
  findUserDocumentByEmail,
  findUserDocumentById,
  createUser,
  updateUserById,
};

export default authRepository;
