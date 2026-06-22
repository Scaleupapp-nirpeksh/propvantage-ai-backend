// File: config/redFlagThresholds.js
// Description: Default thresholds for the red-flag engine (spec §8).
//   Structured so an org-level override object can be merged over the defaults.
//
//   Usage:
//     import { DEFAULT_THRESHOLDS } from '../config/redFlagThresholds.js';
//     const t = { ...DEFAULT_THRESHOLDS, ...orgOverrides };

/**
 * @typedef {object} RedFlagThresholds
 * @property {number} staleLeadDays          - open lead is stale after this many days without interaction (exclusive: > N days)
 * @property {number} noMovementDays         - open lead has "no movement" after this many days without a status change (exclusive: > N days)
 * @property {number} followUpOverdueDays    - follow-up is overdue after nextFollowUpDate is > N days in the past (exclusive: > N days)
 * @property {number} agingPipelineDays      - open lead is "aging pipeline" after this many days since creation (exclusive: > N days)
 * @property {number} lowActivityMinInteractions - flag lowActivity when interactions in the window fall below this count (strict <)
 * @property {number} lowActivityWindowDays  - rolling window (in days) for the low-activity check
 */

/** @type {RedFlagThresholds} */
export const DEFAULT_THRESHOLDS = {
  staleLeadDays: 7,
  noMovementDays: 14,
  followUpOverdueDays: 2,
  agingPipelineDays: 30,
  lowActivityMinInteractions: 5,
  lowActivityWindowDays: 7,
};

export default DEFAULT_THRESHOLDS;
