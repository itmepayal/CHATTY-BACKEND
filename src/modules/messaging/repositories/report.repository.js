import Report from "../models/report.model.js";
import { toObjectId } from "../../../shared/utils/object-id.util.js";

export const create = async (data, options = {}) => {
  if (options.session) {
    const [doc] = await Report.create([data], { session: options.session });
    return doc;
  }
  return Report.create(data);
};

export const exists = async (filter, options = {}) => {
  const query = Report.exists(filter);
  if (options.session) query.session(options.session);
  const found = await query;
  return Boolean(found);
};

export const findById = (id, options = {}) => {
  const query = Report.findById(toObjectId(id));
  if (options.projection) query.select(options.projection);
  if (options.session) query.session(options.session);
  return query;
};

export const find = (filter = {}, projection, options = {}) => {
  const query = Report.find(filter);
  if (projection) query.select(projection);
  if (options.session) query.session(options.session);
  return query;
};

const reportRepository = Object.freeze({
  create,
  exists,
  findById,
  find,
});

export default reportRepository;
