import Report from "../../models/report.model.js";

export const exists = (filter) => Report.exists(filter);

export const create = (data) => Report.create(data);
