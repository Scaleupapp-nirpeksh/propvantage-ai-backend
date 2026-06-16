// File: services/workspace/catalogs/tasksCatalog.js
// Description: Field catalog for the Tasks module. Enums imported from the Task
//   model so they never drift. Derived: assignedToMe (resolves against the
//   viewer), daysOverdue. Spec §3.1. Tasks are org-scoped (no project field on
//   the model), so scope() is org-only.

import mongoose from 'mongoose';
import { TASK_STATUSES, TASK_PRIORITIES, TASK_CATEGORIES } from '../../../models/taskModel.js';
import { OPERATORS, buildMatch } from '../operators.js';

const { ObjectId } = mongoose.Types;

const toObjectId = (v) => (v instanceof ObjectId ? v : new ObjectId(String(v)));

// Terminal statuses — daysOverdue is 0 once a task reaches these states.
const TERMINAL = ['Completed', 'Cancelled'];

/** Enum field helper — delegates to buildMatch for is/in/notIn. */
const enumMatch = (path) => (op, value) => buildMatch(path, op, value);

/** @type {import('./index.js').FieldDescriptor[]} */
const fields = [
  {
    key: 'status',
    label: 'Status',
    type: 'enum',
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    enumValues: TASK_STATUSES,
    displayable: true,
    defaultColumn: true,
    toMatch: enumMatch('status'),
  },
  {
    key: 'priority',
    label: 'Priority',
    type: 'enum',
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    enumValues: TASK_PRIORITIES,
    displayable: true,
    defaultColumn: true,
    toMatch: enumMatch('priority'),
  },
  {
    key: 'category',
    label: 'Category',
    type: 'enum',
    operators: [OPERATORS.IS, OPERATORS.IN, OPERATORS.NOT_IN],
    enumValues: TASK_CATEGORIES,
    displayable: true,
    defaultColumn: true,
    toMatch: enumMatch('category'),
  },
  {
    key: 'dueDate',
    label: 'Due Date',
    type: 'date',
    operators: [
      OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE,
      OPERATORS.BETWEEN, OPERATORS.LAST_N_DAYS,
      OPERATORS.IS_EMPTY, OPERATORS.IS_NOT_EMPTY,
    ],
    displayable: true,
    defaultColumn: true,
    toMatch: (op, value) => buildMatch('dueDate', op, value),
  },
  {
    key: 'assignedToMe',
    label: 'Assigned To Me',
    type: 'boolean',
    operators: [OPERATORS.IS],
    displayable: false,
    derived: true,
    // Resolves against the requesting viewer (spec §3.1). No addFields needed —
    // it's a direct equality against assignedTo using viewerCtx.userId.
    toMatch(op, value, viewerCtx) {
      const me = toObjectId(viewerCtx.userId);
      return value ? { assignedTo: me } : { assignedTo: { $ne: me } };
    },
  },
  {
    key: 'daysOverdue',
    label: 'Days Overdue',
    type: 'number',
    operators: [OPERATORS.GT, OPERATORS.LT, OPERATORS.GTE, OPERATORS.LTE, OPERATORS.BETWEEN],
    displayable: true,
    derived: true,
    addFields() {
      return {
        $addFields: {
          daysOverdue: {
            $cond: {
              if: {
                $or: [
                  { $in: ['$status', TERMINAL] },
                  { $eq: [{ $ifNull: ['$dueDate', null] }, null] },
                ],
              },
              then: 0,
              else: {
                $max: [0, { $dateDiff: { startDate: '$dueDate', endDate: '$$NOW', unit: 'day' } }],
              },
            },
          },
        },
      };
    },
    toMatch: (op, value) => buildMatch('daysOverdue', op, value),
  },
];

/**
 * Catalog module object. `scope(viewerCtx)` returns an org-only $match because
 * Task has no `project` field — it is purely org-scoped.
 * @type {import('./index.js').CatalogModule}
 */
const tasksCatalog = {
  module: 'tasks',
  label: 'Tasks',
  baseModel: 'Task',
  fields,
  scope(viewerCtx) {
    // Task has no project field; org is the only tenant boundary here.
    return { organization: viewerCtx.organization };
  },
};

export default tasksCatalog;
