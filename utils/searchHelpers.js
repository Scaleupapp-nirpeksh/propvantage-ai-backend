// File: utils/searchHelpers.js
// Pure helpers for the global search endpoint (2026-06 Leads refactor).

/** Escape a user string so it is safe to use inside a `new RegExp(...)`. */
export function escapeRegex(str) {
  return String(str == null ? '' : str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * If `q` case-insensitively equals or is a substring of one of `values`
 * (or vice-versa), return that value; else undefined. Used to let the search
 * match a lead by a status / source / priority keyword (e.g. "qual" → Qualified).
 */
export function matchEnum(q, values) {
  const ql = String(q == null ? '' : q).trim().toLowerCase();
  if (!ql) return undefined;
  return values.find((v) => {
    const vl = v.toLowerCase();
    return vl === ql || vl.includes(ql) || ql.includes(vl);
  });
}
