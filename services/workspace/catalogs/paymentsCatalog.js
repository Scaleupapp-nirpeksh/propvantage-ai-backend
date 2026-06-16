// File: services/workspace/catalogs/paymentsCatalog.js
// Description: Field catalog for the Payments module (PaymentTransaction). Spec §3.1.
//   NOTE: PaymentTransaction has no due date (those live on Installment), so the
//   derived `daysOverdue` here is "days a not-yet-settled payment has been
//   outstanding since paymentDate" (0 once completed/cleared). Kept pure + tested
//   so any model change is caught here.

import mongoose from 'mongoose';
import { OPERATORS, buildMatch } from '../operators.js';

const { ObjectId } = mongoose.Types;

// Real enums copied from models/paymentTransactionModel.js (kept in sync via unit tests).
const PAYMENT_STATUSES = ['pending', 'processing', 'completed', 'cleared', 'bounced', 'cancelled', 'refunded'];
const PAYMENT_METHODS = ['cash', 'cheque', 'bank_transfer', 'online_payment', 'card_payment', 'demand_draft', 'home_loan'];

// Statuses that mean the payment is settled (daysOverdue = 0).
const SETTLED = ['completed', 'cleared'];

const toObjectId = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));
const num = (v) => (typeof v === 'number' ? v : Number(v));
const daysAgo = (n) => new Date(Date.now() - num(n) * 24 * 60 * 60 * 1000);

/** @type {import('./index.js').FieldDescriptor[]} */
const fields = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    enumValues: PAYMENT_STATUSES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('status', op, value),
  },
  {
    key: 'paymentMethod',
    label: 'Payment Method',
    type: 'enum',
    enumValues: PAYMENT_METHODS,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('paymentMethod', op, value),
  },
  {
    key: 'amount',
    label: 'Amount',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: true,
    // Number coercion: values may arrive as strings from the query builder.
    toMatch: (op, value) => {
      switch (op) {
        case OPERATORS.GT:  return { amount: { $gt: num(value) } };
        case OPERATORS.LT:  return { amount: { $lt: num(value) } };
        case OPERATORS.GTE: return { amount: { $gte: num(value) } };
        case OPERATORS.LTE: return { amount: { $lte: num(value) } };
        case OPERATORS.BETWEEN: {
          const [lo, hi] = Array.isArray(value) ? value : [value, value];
          return { amount: { $gte: num(lo), $lte: num(hi) } };
        }
        default: throw new Error(`Unsupported operator '${op}' for field 'amount'`);
      }
    },
  },
  {
    key: 'paymentDate',
    label: 'Payment Date',
    type: 'date',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN, OPERATORS.LAST_N_DAYS],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => {
      if (op === OPERATORS.LAST_N_DAYS) return { paymentDate: { $gte: daysAgo(value) } };
      return buildMatch('paymentDate', op, value);
    },
  },
  {
    key: 'daysOverdue',
    label: 'Days Outstanding',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    defaultColumn: false,
    derived: true,
    // Computes whole days a not-yet-settled payment has been outstanding since
    // paymentDate. Returns 0 once status is completed or cleared.
    // NOTE: PaymentTransaction has no due-date field; due dates live on Installment.
    // If a first-class due-date is added to PaymentTransaction, update this field.
    addFields() {
      return {
        $addFields: {
          daysOverdue: {
            $cond: {
              if: { $in: ['$status', SETTLED] },
              then: 0,
              else: { $dateDiff: { startDate: '$paymentDate', endDate: '$$NOW', unit: 'day' } },
            },
          },
        },
      };
    },
    toMatch: (op, value) => buildMatch('daysOverdue', op, value),
  },
];

/**
 * Catalog module object. `scope(viewerCtx)` returns the base $match: always the
 * org boundary, plus project scoping unless the viewer is an owner.
 * @type {import('./index.js').CatalogModule}
 */
const paymentsCatalog = {
  module: 'payments',
  label: 'Payments',
  baseModel: 'PaymentTransaction',
  fields,
  scope(viewerCtx) {
    const match = { organization: viewerCtx.organization };
    if (!viewerCtx.isOwner) {
      match.project = { $in: (viewerCtx.accessibleProjectIds || []).map(toObjectId) };
    }
    return match;
  },
};

export default paymentsCatalog;
