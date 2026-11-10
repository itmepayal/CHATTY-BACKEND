import {
  MAX_NICKNAME_LENGTH,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from "../constants/contacts/contact.constants.js";

/**
 * Sanitizes and bounds a contact nickname string.
 * @param {any} nickname
 * @returns {string|undefined}
 */
export const sanitizeNickname = (nickname) => {
  if (typeof nickname !== "string") return undefined;
  const trimmed = nickname.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_NICKNAME_LENGTH) : undefined;
};

/**
 * Escapes special regex characters in a search string.
 * @param {string} str
 * @returns {string}
 */
export const escapeRegex = (str) =>
  String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Parses and bounds pagination parameters.
 * @param {object} query
 * @param {any} [query.page]
 * @param {any} [query.limit]
 * @param {any} [query.search]
 * @returns {{ isPaginated: boolean, pageNum: number, limitNum: number, skip: number, search: string }}
 */
export const parsePagination = ({ page, limit, search } = {}) => {
  const isPaginated = page !== undefined || limit !== undefined;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(
    MAX_PAGE_LIMIT,
    Math.max(1, parseInt(limit, 10) || DEFAULT_PAGE_LIMIT),
  );
  const skip = (pageNum - 1) * limitNum;
  const sanitizedSearch = typeof search === "string" ? search.trim() : "";

  return {
    isPaginated,
    pageNum,
    limitNum,
    skip,
    search: sanitizedSearch,
  };
};
