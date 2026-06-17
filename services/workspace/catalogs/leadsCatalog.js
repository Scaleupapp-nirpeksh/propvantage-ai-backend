// File: services/workspace/catalogs/leadsCatalog.js
// Description: Field Catalog for the Leads module — the allow-list of
// queryable/derived fields that drive the Workspace builder, NL compiler, and
// query engine. Each FieldDescriptor owns its own toMatch(); derived fields
// additionally declare addFields() aggregation stages.
//
// DERIVATION NOTE (daysSinceLastCPFollowUp / daysSinceLastActivity):
// The Lead model has NO dedicated "last CP follow-up" timestamp (verified
// against models/leadModel.js and models/interactionModel.js).
//
// daysSinceLastCPFollowUp — CP-ONLY. Uses ONLY the max channelPartnerAttribution
// .history[].at timestamp. Null when the lead has no CP history (no fallback),
// so "stale CP" filters only match genuine CP leads and non-CP leads render "—".
//
// daysSinceLastActivity — general staleness lens. Takes the max of CP history,
// engagementMetrics.lastInteractionDate, statusChangedAt, and createdAt.
// ($max ignores nulls, so the result is always non-null.)
//
// If a first-class CP-follow-up timestamp is added later, only this file changes.

import mongoose from 'mongoose';
import { OPERATORS, buildMatch } from '../operators.js';

const { ObjectId } = mongoose.Types;

// Real enums copied from models/leadModel.js (kept in sync via unit tests).
export const LEAD_STATUS_VALUES = [
  'pending', 'New', 'Qualified', 'Site Visit Completed',
  'Negotiating', 'Booked', 'Lost', 'Revived',
];
export const LEAD_SOURCE_VALUES = [
  'Channel Partner', 'Management', 'Direct', 'Referral', 'Marketing', 'Cold Calling',
];
export const CP_ATTRIBUTION_STATUS_VALUES = ['tagged', 'pending', 'approved', 'rejected'];

const toObjectId = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));

/** @type {import('../catalogs/index.js').FieldDescriptor[]} */
const fields = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    enumValues: LEAD_STATUS_VALUES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('status', op, value),
  },
  {
    key: 'source',
    label: 'Source',
    type: 'enum',
    enumValues: LEAD_SOURCE_VALUES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('source', op, value),
  },
  {
    key: 'assignedTo',
    label: 'Assigned To',
    type: 'ref',
    refModel: 'User',
    refLabelFields: ['firstName', 'lastName'],
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.IS_EMPTY, OPERATORS.IS_NOT_EMPTY],
    displayable: true,
    defaultColumn: false,
    toMatch: (op, value) => {
      if (op === OPERATORS.IS_EMPTY || op === OPERATORS.IS_NOT_EMPTY) {
        return buildMatch('assignedTo', op, value);
      }
      if (op === OPERATORS.IN) {
        return { assignedTo: { $in: (Array.isArray(value) ? value : [value]).map(toObjectId) } };
      }
      return { assignedTo: toObjectId(value) };
    },
  },
  {
    key: 'cpStatus',
    label: 'CP status',
    type: 'enum',
    enumValues: CP_ATTRIBUTION_STATUS_VALUES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: false,
    derived: true,
    // The value lives at a nested path; lift it to a top-level `cpStatus` so it
    // renders as a column. Filtering still targets the nested path (toMatch).
    addFields: () => [{ $addFields: { cpStatus: '$channelPartnerAttribution.status' } }],
    toMatch: (op, value) => buildMatch('channelPartnerAttribution.status', op, value),
  },
  {
    key: 'channelPartner',
    label: 'Channel Partner',
    type: 'ref',
    refArray: true,
    refModel: 'ChannelPartner',
    refPath: 'channelPartnerAttribution.partners.channelPartner',
    refLabelFields: ['firmName'],
    operators: [OPERATORS.IS_EMPTY, OPERATORS.IS_NOT_EMPTY],
    displayable: true,
    defaultColumn: true,
    // "has CP / no CP" via array-element existence (viaChannelPartner can be stale).
    toMatch: (op) => ({
      'channelPartnerAttribution.partners.0': { $exists: op === OPERATORS.IS_NOT_EMPTY },
    }),
  },
  {
    key: 'cpAgent',
    label: 'CP Agent',
    type: 'ref',
    refArray: true,
    refModel: 'User',
    refPath: 'channelPartnerAttribution.partners.agentUser',
    refLabelFields: ['firstName', 'lastName'],
    operators: [OPERATORS.IS_EMPTY, OPERATORS.IS_NOT_EMPTY],
    displayable: true,
    defaultColumn: false,
    toMatch: (op) =>
      op === OPERATORS.IS_NOT_EMPTY
        ? { 'channelPartnerAttribution.partners': { $elemMatch: { agentUser: { $ne: null } } } }
        : { 'channelPartnerAttribution.partners': { $not: { $elemMatch: { agentUser: { $ne: null } } } } },
  },
  {
    key: 'assignedToMe',
    label: 'Assigned to me',
    type: 'boolean',
    operators: [OPERATORS.IS],
    displayable: false,
    derived: true,
    // Resolves against the viewer at query time — never the card author.
    toMatch: (op, value, viewerCtx) => {
      const me = toObjectId(viewerCtx.userId);
      return value === false ? { assignedTo: { $ne: me } } : { assignedTo: me };
    },
  },
  {
    key: 'score',
    label: 'Score',
    type: 'number',
    operators: [
      OPERATORS.IS, OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN,
    ],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('score', op, value),
  },
  {
    key: 'createdAt',
    label: 'Created',
    type: 'date',
    operators: [
      OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE,
      OPERATORS.BETWEEN, OPERATORS.LAST_N_DAYS,
    ],
    displayable: true,
    defaultColumn: false,
    toMatch: (op, value) => buildMatch('createdAt', op, value),
  },
  {
    key: 'daysInCurrentStatus',
    label: 'Days in current status',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: false,
    derived: true,
    addFields: () => [
      {
        $addFields: {
          daysInCurrentStatus: {
            $dateDiff: {
              startDate: { $ifNull: ['$statusChangedAt', '$createdAt'] },
              endDate: '$$NOW',
              unit: 'day',
            },
          },
        },
      },
    ],
    toMatch: (op, value) => buildMatch('daysInCurrentStatus', op, value),
  },
  {
    key: 'daysSinceLastCPFollowUp',
    label: 'Days since CP follow-up',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: true,
    derived: true,
    // CP-ONLY: days since the most recent channel-partner action. NULL when the
    // lead has no CP history (no fallback) — so "stale CP" filters only match
    // genuine CP leads, and non-CP leads render "—".
    addFields: () => [
      { $addFields: { __lastCPFollowUpAt: { $max: '$channelPartnerAttribution.history.at' } } },
      {
        $addFields: {
          daysSinceLastCPFollowUp: {
            $dateDiff: { startDate: '$__lastCPFollowUpAt', endDate: '$$NOW', unit: 'day' },
          },
        },
      },
    ],
    toMatch: (op, value) => buildMatch('daysSinceLastCPFollowUp', op, value),
  },
  {
    key: 'daysSinceLastActivity',
    label: 'Days since last activity',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: false,
    derived: true,
    // General staleness: most recent of CP action, internal interaction, status
    // change, or creation. ($max ignores nulls.)
    addFields: () => [
      {
        $addFields: {
          __lastActivityAt: {
            $max: [
              { $max: '$channelPartnerAttribution.history.at' },
              '$engagementMetrics.lastInteractionDate',
              '$statusChangedAt',
              '$createdAt',
            ],
          },
        },
      },
      {
        $addFields: {
          daysSinceLastActivity: {
            $dateDiff: { startDate: '$__lastActivityAt', endDate: '$$NOW', unit: 'day' },
          },
        },
      },
    ],
    toMatch: (op, value) => buildMatch('daysSinceLastActivity', op, value),
  },
];

/**
 * Catalog module object. `scope(viewerCtx)` returns the base $match: always the
 * org boundary, plus project scoping unless the viewer has full access
 * (accessibleProjectIds === null).
 * @type {import('../catalogs/index.js').CatalogModule}
 */
export const leadsCatalog = {
  module: 'leads',
  label: 'Leads',
  baseModel: 'Lead',
  fields,
  scope: (viewerCtx) => {
    const match = { organization: toObjectId(viewerCtx.organization) };
    if (Array.isArray(viewerCtx.accessibleProjectIds)) {
      match.project = { $in: viewerCtx.accessibleProjectIds.map(toObjectId) };
    }
    return match;
  },
};

export default leadsCatalog;
