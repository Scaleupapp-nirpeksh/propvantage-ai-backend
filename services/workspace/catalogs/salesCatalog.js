// File: services/workspace/catalogs/salesCatalog.js
// Description: Field catalog for the Sales/Bookings module. An allow-list of
//   filterable/selectable fields, each with a toMatch() mapper. Derived fields
//   (daysInCurrentStatus) are aggregation-backed via addFields(). Co-located
//   with the model so model changes surface in these unit tests. Spec §3.1.

import mongoose from 'mongoose';
import { OPERATORS, buildMatch } from '../operators.js';

const { ObjectId } = mongoose.Types;

// Real enums copied from models/salesModel.js (kept in sync via unit tests).
const SALE_STATUSES = [
  'Pending Approval', 'Booked', 'Agreement Signed', 'Registered', 'Completed', 'Cancelled',
];

const toObjectId = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));
const num = (v) => (typeof v === 'number' ? v : Number(v));
const daysAgo = (n) => new Date(Date.now() - num(n) * 24 * 60 * 60 * 1000);

/** @type {import('../catalogs/index.js').FieldDescriptor[]} */
const fields = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    enumValues: SALE_STATUSES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('status', op, value),
  },
  {
    key: 'bookingDate',
    label: 'Booking Date',
    type: 'date',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN, OPERATORS.LAST_N_DAYS],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => {
      if (op === OPERATORS.LAST_N_DAYS) return { bookingDate: { $gte: daysAgo(value) } };
      return buildMatch('bookingDate', op, value);
    },
  },
  {
    key: 'salePrice',
    label: 'Sale Price',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: true,
    // Number coercion: values may arrive as strings from the query builder.
    toMatch: (op, value) => {
      switch (op) {
        case OPERATORS.GT:  return { salePrice: { $gt: num(value) } };
        case OPERATORS.LT:  return { salePrice: { $lt: num(value) } };
        case OPERATORS.GTE: return { salePrice: { $gte: num(value) } };
        case OPERATORS.LTE: return { salePrice: { $lte: num(value) } };
        case OPERATORS.BETWEEN: {
          const [lo, hi] = Array.isArray(value) ? value : [value, value];
          return { salePrice: { $gte: num(lo), $lte: num(hi) } };
        }
        default: throw new Error(`Unsupported operator '${op}' for field 'salePrice'`);
      }
    },
  },
  {
    key: 'channelPartner',
    label: 'Channel Partner',
    type: 'ref',
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.IS_EMPTY, OPERATORS.IS_NOT_EMPTY],
    displayable: true,
    defaultColumn: false,
    toMatch: (op, value) => {
      if (op === OPERATORS.IS) return { channelPartner: toObjectId(value) };
      if (op === OPERATORS.IN) {
        return { channelPartner: { $in: (Array.isArray(value) ? value : [value]).map(toObjectId) } };
      }
      if (op === OPERATORS.IS_EMPTY)    return { channelPartner: { $in: [null, undefined] } };
      if (op === OPERATORS.IS_NOT_EMPTY) return { channelPartner: { $ne: null } };
      throw new Error(`Unsupported operator '${op}' for field 'channelPartner'`);
    },
  },
  {
    key: 'daysInCurrentStatus',
    label: 'Days In Current Status',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: false,
    derived: true,
    // Whole days since the doc last changed (proxy for "time in current status",
    // since status changes bump updatedAt). Materialized before $match.
    addFields: () => ({
      $addFields: {
        daysInCurrentStatus: {
          $dateDiff: { startDate: '$updatedAt', endDate: '$$NOW', unit: 'day' },
        },
      },
    }),
    toMatch: (op, value) => buildMatch('daysInCurrentStatus', op, value),
  },
];

/**
 * Catalog module object. `scope(viewerCtx)` returns the base $match: always
 * the org boundary, plus project scoping unless the viewer is an owner.
 * @type {import('../catalogs/index.js').CatalogModule}
 */
const salesCatalog = {
  module: 'sales',
  label: 'Sales / Bookings',
  baseModel: 'Sale',
  fields,
  scope: (viewerCtx) => {
    const match = { organization: viewerCtx.organization };
    if (!viewerCtx.isOwner) {
      const ids = (viewerCtx.accessibleProjectIds || []).map(toObjectId);
      match.project = { $in: ids };
    }
    return match;
  },
};

export default salesCatalog;
