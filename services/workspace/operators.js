// File: services/workspace/operators.js
// Description: Canonical operator enum for Workspace Query Plans + a generic
// helper that turns a (field, op, value) triple into a Mongo match fragment for
// the common cases. Field-specific catalogs may override via their own toMatch.

/**
 * The exact, ordered operator key set shared across the builder UI, the NL
 * compiler, and the query engine. Order is contract — tests assert it.
 */
export const OPERATORS = Object.freeze({
  IS: 'is',
  IN: 'in',
  NOT_IN: 'notIn',
  GT: 'gt',
  LT: 'lt',
  GTE: 'gte',
  LTE: 'lte',
  BETWEEN: 'between',
  LAST_N_DAYS: 'lastNDays',
  IS_EMPTY: 'isEmpty',
  IS_NOT_EMPTY: 'isNotEmpty',
  CONTAINS: 'contains',
});

/** Array form used by Joi `.valid(...)` and by FieldDescriptor.operators lists. */
export const OPERATOR_LIST = Object.freeze(Object.values(OPERATORS));

/**
 * Generic (field, op, value) -> Mongo match fragment for a *physical* path.
 * Catalog fields whose stored path differs from `key` pass `path`; derived
 * fields generally implement their own toMatch and do not call this.
 *
 * @param {string} path  Mongo document path to match against.
 * @param {string} op    One of OPERATOR_LIST.
 * @param {*} value      The user-supplied value.
 * @returns {object}     A Mongo match fragment, e.g. { status: { $gte: 15 } }.
 */
export const buildMatch = (path, op, value) => {
  switch (op) {
    case OPERATORS.IS:
      return { [path]: value };
    case OPERATORS.IN:
      return { [path]: { $in: Array.isArray(value) ? value : [value] } };
    case OPERATORS.NOT_IN:
      return { [path]: { $nin: Array.isArray(value) ? value : [value] } };
    case OPERATORS.GT:
      return { [path]: { $gt: value } };
    case OPERATORS.LT:
      return { [path]: { $lt: value } };
    case OPERATORS.GTE:
      return { [path]: { $gte: value } };
    case OPERATORS.LTE:
      return { [path]: { $lte: value } };
    case OPERATORS.BETWEEN: {
      const [min, max] = Array.isArray(value) ? value : [value, value];
      return { [path]: { $gte: min, $lte: max } };
    }
    case OPERATORS.LAST_N_DAYS: {
      const since = new Date(Date.now() - Number(value) * 24 * 60 * 60 * 1000);
      return { [path]: { $gte: since } };
    }
    case OPERATORS.IS_EMPTY:
      return { $or: [{ [path]: null }, { [path]: { $exists: false } }] };
    case OPERATORS.IS_NOT_EMPTY:
      return { [path]: { $nin: [null] }, [`${path}`]: { $exists: true, $ne: null } };
    case OPERATORS.CONTAINS:
      return { [path]: { $regex: String(value), $options: 'i' } };
    default:
      throw new Error(`Unsupported operator: ${op}`);
  }
};
