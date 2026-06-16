// File: services/workspace/catalogs/leadsCatalog.js
// Description: Field Catalog for the Leads module — the allow-list of
// queryable/derived fields that drive the Workspace builder, NL compiler, and
// query engine. Each FieldDescriptor owns its own toMatch(); derived fields
// additionally declare addFields() aggregation stages.
//
// DERIVATION NOTE (daysSinceLastCPFollowUp): the Lead model has NO dedicated
// "last CP follow-up" timestamp (verified against models/leadModel.js and
// models/interactionModel.js). We derive it from the most recent
// channelPartnerAttribution.history[].at entry (CP actions are appended there),
// falling back to engagementMetrics.lastInteractionDate, then createdAt. This
// keeps the mapper co-located with the catalog and avoids a cross-collection
// $lookup. If a first-class CP-follow-up timestamp is added later, only this
// file changes.

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
    label: 'Days since last CP follow-up',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: true,
    derived: true,
    addFields: () => [
      {
        $addFields: {
          // Most recent CP action timestamp; documented fallback chain.
          __lastCPFollowUpAt: {
            $ifNull: [
              { $max: '$channelPartnerAttribution.history.at' },
              { $ifNull: ['$engagementMetrics.lastInteractionDate', '$createdAt'] },
            ],
          },
        },
      },
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
