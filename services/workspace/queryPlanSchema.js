// File: services/workspace/queryPlanSchema.js
// Description: Joi schema + validateQueryPlan() for the canonical Workspace
// Query Plan. Single source of truth for allowed modules, operators, limit cap.

import Joi from 'joi';
import { OPERATOR_LIST } from './operators.js';

/** The five queryable modules. Order is contract — tests assert it. */
export const MODULES = Object.freeze([
  'leads',
  'sales',
  'payments',
  'tasks',
  'channelPartners',
]);

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

const filterSchema = Joi.object({
  field: Joi.string().trim().min(1).required(),
  op: Joi.string()
    .valid(...OPERATOR_LIST)
    .required(),
  // value is intentionally permissive (any) — per-field type/op validity is
  // enforced by the catalog in the engine, not here.
  value: Joi.any(),
}).prefs({ presence: 'optional' });

const sortSchema = Joi.object({
  field: Joi.string().trim().min(1).required(),
  dir: Joi.string().valid('asc', 'desc').required(),
});

export const queryPlanSchema = Joi.object({
  module: Joi.string()
    .valid(...MODULES)
    .required(),
  // v1 is AND-only; the field exists so OR/grouping can land later without a
  // data migration.
  logic: Joi.string().valid('AND').default('AND'),
  filters: Joi.array().items(filterSchema).min(1).required(),
  sort: sortSchema.allow(null).default(null),
  limit: Joi.number().integer().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  nlSource: Joi.string().allow(null, '').default(null),
}).prefs({ stripUnknown: true, abortEarly: true, convert: true });

/**
 * Validate (and coerce defaults on) a Query Plan.
 * @param {object} plan Raw plan from the builder or the NL compiler.
 * @returns {{ value: object, error: (Joi.ValidationError|undefined) }}
 */
export const validateQueryPlan = (plan) => {
  const { value, error } = queryPlanSchema.validate(plan);
  return { value, error };
};
