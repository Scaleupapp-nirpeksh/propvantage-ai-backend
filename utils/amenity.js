// File: utils/amenity.js
// Pure helpers for the org-scoped amenity catalog (2026-06 Leads refactor).
// normalizeAmenityName → display form (trimmed, single-spaced, case preserved).
// amenityKey → case-insensitive dedupe key used for the unique index.

export function normalizeAmenityName(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
}

export function amenityKey(raw) {
  return normalizeAmenityName(raw).toLowerCase();
}
