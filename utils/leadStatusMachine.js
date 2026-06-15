// File: utils/leadStatusMachine.js
// Centralised Lead status state machine for the 2026-06 Leads refactor.
// Pure + DB-free. Used by the lead controller (updateLead, changeLeadStatus)
// so every status mutation goes through one set of rules.
//
// 'pending' is the CP intake queue (not a sales-funnel UI stage). The internal
// terminal value stays 'Booked'; the UI labels it "Booking".

export const LEAD_STATUSES = [
  'pending',
  'New',
  'Qualified',
  'Site Visit Completed',
  'Negotiating',
  'Booked',
  'Lost',
  'Revived',
];

export const LEAD_STATUS_TRANSITIONS = {
  pending: ['New', 'Lost'],
  New: ['Qualified', 'Lost'],
  Qualified: ['Site Visit Completed', 'Lost'],
  'Site Visit Completed': ['Negotiating', 'Booked', 'Lost'],
  Negotiating: ['Booked', 'Lost'],
  Booked: ['Lost'],
  Lost: ['Revived'],
  Revived: ['Site Visit Completed', 'Negotiating'],
};

/** Is moving from `from` → `to` allowed? A no-op (from === to) is always allowed. */
export function canTransition(from, to) {
  if (!LEAD_STATUSES.includes(to)) return false;
  if (from === to) return true;
  return (LEAD_STATUS_TRANSITIONS[from] || []).includes(to);
}

/** Throw a descriptive Error if the transition is not allowed; return true otherwise. */
export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid lead status transition: ${from} → ${to}`);
  }
  return true;
}

/** The statuses a lead in `from` may move to next (excludes itself). */
export function allowedNextStatuses(from) {
  return LEAD_STATUS_TRANSITIONS[from] || [];
}
