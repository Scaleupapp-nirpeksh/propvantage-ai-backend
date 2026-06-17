// File: services/workspace/catalogs/projectsCatalog.js
// Description: Field Catalog for the Projects module — the allow-list of
// queryable/derived fields that drive the Workspace builder, NL compiler, and
// query engine for the Projects module (Theme D1).
//
// Scoping nuance: Projects rows ARE projects, so scope() filters on the
// project's own `_id` (not a `project` field as with leads/sales etc.).

import mongoose from 'mongoose';
import { OPERATORS, buildMatch } from '../operators.js';

const { ObjectId } = mongoose.Types;

// Real enums copied from models/projectModel.js (kept in sync via unit tests).
export const PROJECT_STATUS_VALUES = [
  'planning', 'pre-launch', 'launched', 'under-construction', 'completed', 'on-hold',
];
export const PROJECT_TYPE_VALUES = [
  'apartment', 'villa', 'plot', 'commercial',
];

const toObjectId = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));

/** @type {import('../catalogs/index.js').FieldDescriptor[]} */
const fields = [
  {
    key: 'name',
    label: 'Name',
    type: 'string',
    operators: [OPERATORS.IS, OPERATORS.CONTAINS],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('name', op, value),
  },
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    enumValues: PROJECT_STATUS_VALUES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('status', op, value),
  },
  {
    key: 'type',
    label: 'Type',
    type: 'enum',
    enumValues: PROJECT_TYPE_VALUES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    toMatch: (op, value) => buildMatch('type', op, value),
  },
  {
    key: 'city',
    label: 'City',
    type: 'string',
    operators: [OPERATORS.IS, OPERATORS.CONTAINS],
    displayable: true,
    defaultColumn: true,
    derived: true,
    // Lift the nested location.city to a top-level `city` so it renders as a
    // column. Filtering still targets the nested path (toMatch below).
    addFields: () => [{ $addFields: { city: '$location.city' } }],
    toMatch: (op, value) => buildMatch('location.city', op, value),
  },
  {
    key: 'totalUnits',
    label: 'Total Units',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    toMatch: (op, value) => buildMatch('totalUnits', op, value),
  },
  {
    key: 'targetRevenue',
    label: 'Target Revenue',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    toMatch: (op, value) => buildMatch('targetRevenue', op, value),
  },
  {
    key: 'launchDate',
    label: 'Launch Date',
    type: 'date',
    operators: [
      OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE,
      OPERATORS.BETWEEN, OPERATORS.LAST_N_DAYS,
    ],
    displayable: true,
    toMatch: (op, value) => buildMatch('launchDate', op, value),
  },
  {
    key: 'expectedCompletionDate',
    label: 'Expected Completion',
    type: 'date',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    toMatch: (op, value) => buildMatch('expectedCompletionDate', op, value),
  },
  {
    key: 'createdAt',
    label: 'Created',
    type: 'date',
    operators: [
      OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE,
      OPERATORS.BETWEEN, OPERATORS.LAST_N_DAYS,
    ],
    displayable: false,
    toMatch: (op, value) => buildMatch('createdAt', op, value),
  },
];

/**
 * Catalog module object. `scope(viewerCtx)` returns the base $match:
 * always the org boundary. For non-owners, additionally scopes by
 * the project's own `_id` (rows ARE projects, so we filter `_id` not `project`).
 * @type {import('../catalogs/index.js').CatalogModule}
 */
export const projectsCatalog = {
  module: 'projects',
  label: 'Projects',
  baseModel: 'Project',
  projectField: '_id', // global project switcher narrows on the project's own _id
  fields,
  scope: (viewerCtx) => {
    const match = { organization: toObjectId(viewerCtx.organization) };
    if (Array.isArray(viewerCtx.accessibleProjectIds)) {
      match._id = { $in: viewerCtx.accessibleProjectIds.map(toObjectId) };
    }
    return match;
  },
};

export default projectsCatalog;
