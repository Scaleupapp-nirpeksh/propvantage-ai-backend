// File: services/workspace/catalogs/supportTicketsCatalog.js
// Description: Field Catalog for the Support Tickets module — the allow-list of
// queryable/derived fields that drive the Workspace builder, NL compiler, and
// query engine for support tickets (email-to-ticket).
//
// Scoping nuance: SupportTicket has NO `project` field — it is purely org-scoped.
// So scope() is org-only (no projectField), like tasks/channelPartners.

import mongoose from 'mongoose';
import {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  TICKET_CATEGORIES,
} from '../../../models/supportTicketModel.js';
import { OPERATORS, buildMatch } from '../operators.js';

const { ObjectId } = mongoose.Types;

const toObjectId = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));

/** Enum field helper — delegates to buildMatch for is/in/notIn. */
const enumMatch = (path) => (op, value) => buildMatch(path, op, value);

/** @type {import('./index.js').FieldDescriptor[]} */
const fields = [
  {
    key: 'displayId',
    label: 'Ticket ID',
    type: 'string',
    operators: [OPERATORS.CONTAINS, OPERATORS.IS],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('displayId', op, value),
  },
  {
    key: 'subject',
    label: 'Subject',
    type: 'string',
    operators: [OPERATORS.CONTAINS, OPERATORS.IS],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('subject', op, value),
  },
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    enumValues: TICKET_STATUSES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: enumMatch('status'),
  },
  {
    key: 'category',
    label: 'Category',
    type: 'enum',
    enumValues: TICKET_CATEGORIES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    defaultColumn: true,
    toMatch: enumMatch('category'),
  },
  {
    key: 'priority',
    label: 'Priority',
    type: 'enum',
    enumValues: TICKET_PRIORITIES,
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    displayable: true,
    toMatch: enumMatch('priority'),
  },
  {
    key: 'clientEmail',
    label: 'Client Email',
    type: 'string',
    operators: [OPERATORS.CONTAINS, OPERATORS.IS],
    displayable: true,
    derived: true,
    // Lift the nested client.email to a top-level `clientEmail` so it renders as
    // a column. Filtering still targets the nested path (toMatch below).
    addFields: () => [{ $addFields: { clientEmail: '$client.email' } }],
    toMatch: (op, value) => buildMatch('client.email', op, value),
  },
  {
    key: 'assignee',
    label: 'Assignee',
    type: 'ref',
    refModel: 'User',
    refPath: 'assignee',
    refLabelFields: ['firstName', 'lastName'],
    operators: [OPERATORS.IS, OPERATORS.IS_EMPTY, OPERATORS.IS_NOT_EMPTY],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => {
      if (op === OPERATORS.IS_EMPTY || op === OPERATORS.IS_NOT_EMPTY) {
        return buildMatch('assignee', op, value);
      }
      return { assignee: toObjectId(value) };
    },
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
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('createdAt', op, value),
  },
  {
    key: 'closedAt',
    label: 'Closed',
    type: 'date',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    toMatch: (op, value) => buildMatch('closedAt', op, value),
  },
  {
    key: 'daysOpen',
    label: 'Days Open',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE],
    displayable: true,
    derived: true,
    addFields: () => [
      {
        $addFields: {
          daysOpen: {
            $dateDiff: { startDate: '$createdAt', endDate: '$$NOW', unit: 'day' },
          },
        },
      },
    ],
    toMatch: (op, value) => buildMatch('daysOpen', op, value),
  },
];

/**
 * Catalog module object. `scope(viewerCtx)` returns an org-only $match because
 * SupportTicket has no `project` field — org is the only tenant boundary here.
 * @type {import('./index.js').CatalogModule}
 */
export const supportTicketsCatalog = {
  module: 'supportTickets',
  label: 'Support Tickets',
  baseModel: 'SupportTicket',
  fields,
  scope: (viewerCtx) => ({ organization: toObjectId(viewerCtx.organization) }),
};

export default supportTicketsCatalog;
