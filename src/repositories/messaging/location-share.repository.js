import LocationShare from "../../models/location-share.model.js";
import { toObjectId } from "../../utils/object-id.util.js";

export const create = async (data, options = {}) => {
  if (options.session) {
    const [doc] = await LocationShare.create([data], {
      session: options.session,
    });
    return doc;
  }
  return LocationShare.create(data);
};

export const find = (filter = {}, projection, options = {}) => {
  const query = LocationShare.find(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findOne = (filter = {}, projection, options = {}) => {
  const query = LocationShare.findOne(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

export const findById = (id, options = {}) => {
  const query = LocationShare.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const updateOne = (filter, update, options = {}) =>
  LocationShare.updateOne(filter, update, options);

export const updateMany = (filter, update, options = {}) =>
  LocationShare.updateMany(filter, update, options);

export const deleteOne = (filter, options = {}) =>
  LocationShare.deleteOne(filter, options);

export const deleteMany = (filter, options = {}) =>
  LocationShare.deleteMany(filter, options);

const locationShareRepository = Object.freeze({
  create,
  find,
  findOne,
  findById,
  updateOne,
  updateMany,
  deleteOne,
  deleteMany,
});

export default locationShareRepository;
