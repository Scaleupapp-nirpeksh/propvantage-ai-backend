// File: data/leadEnumMigrationMaps.js
// Pure legacy→new value maps for the 2026-06 "developer-ready" Lead refactor.
// Imported by data/migrateLeadsDeveloperReady.js. Pure + DB-free so the
// mappings are unit-tested in isolation.

export const NEW_SOURCES = ['Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling'];

const SOURCE_MAP = {
  Referral: 'Referral',
  'Channel Partner': 'Channel Partner',
  'Walk-in': 'Direct',
  'Cold Call': 'Cold Calling',
  Website: 'Marketing',
  'Property Portal': 'Marketing',
  'Social Media': 'Marketing',
  Advertisement: 'Marketing',
  Other: 'Direct',
};

const BUDGET_SOURCE_MAP = {
  self_reported: 'self_funded',
  pre_approved: 'bank_loan',
  loan_approved: 'bank_loan',
  verified: 'bank_loan',
};

// Conservative status remap (decision 2026-06-15).
const STATUS_MAP = {
  Contacted: 'New',
  'Site Visit Scheduled': 'Qualified',
  Unqualified: 'Lost',
};

const FOLLOWUP_TYPE_MAP = {
  whatsapp: 'text',
  site_visit: 'meeting',
};

export function mapSource(old) {
  if (NEW_SOURCES.includes(old)) return old;
  return SOURCE_MAP[old] || 'Direct';
}
export function mapBudgetSource(old) {
  if (old === 'self_funded' || old === 'bank_loan') return old;
  return BUDGET_SOURCE_MAP[old] || 'self_funded';
}
export function mapStatus(old) {
  return STATUS_MAP[old] || old; // valid/unmapped statuses pass through
}
export function mapFollowUpType(old) {
  return FOLLOWUP_TYPE_MAP[old] || old;
}
