// File: services/workspace/queryEngine.js
// Description: The Workspace query engine. Compiles a validated Query Plan into a
// Mongo aggregation pipeline, ALWAYS re-scoped to the viewer (org +
// accessibleProjectIds via catalog.scope), and runs it in list or metric mode.
//
//   runQueryPlan(plan, viewerCtx)                                   -> { rows, total }
//   runQueryPlan(plan, viewerCtx, { renderMode:'metric', metricConfig }) -> { value, breakdown }
//
// Security: scoping is taken from viewerCtx (built from the authenticated req in
// the controller), NEVER from the plan. Derived fields are materialised only
// when referenced by a filter or sort, keeping pipelines minimal.

import mongoose from 'mongoose';
import { validateQueryPlan } from './queryPlanSchema.js';
import { getCatalog } from './catalogs/index.js';

/** Build a field-key -> FieldDescriptor lookup for a catalog. */
const indexFields = (catalog) => {
  const map = new Map();
  catalog.fields.forEach((f) => map.set(f.key, f));
  return map;
};

/** Keys referenced by the plan's filters + sort (the only derived fields we add). */
const referencedKeys = (plan) => {
  const keys = new Set(plan.filters.map((f) => f.field));
  if (plan.sort?.field) keys.add(plan.sort.field);
  return keys;
};

/**
 * Run a Query Plan under a viewer's scope.
 * @param {object} plan Raw or validated Query Plan (§3.3).
 * @param {object} viewerCtx { organization, userId, accessibleProjectIds, isOwner, permissions }.
 * @param {object} [opts] { renderMode:'list'|'metric', metricConfig:{ agg, field } }.
 * @returns {Promise<{rows:object[], total:number}|{value:number, breakdown:object[]}>}
 */
export const runQueryPlan = async (plan, viewerCtx, opts = {}) => {
  const { value: validPlan, error } = validateQueryPlan(plan);
  if (error) throw new Error(`Invalid query plan: ${error.message}`);

  const catalog = getCatalog(validPlan.module);
  const byKey = indexFields(catalog);

  // Every referenced field must be in the catalog allow-list.
  referencedKeys(validPlan).forEach((key) => {
    if (!byKey.has(key)) throw new Error(`Unknown field for module ${validPlan.module}: ${key}`);
  });

  const Model = mongoose.model(catalog.baseModel);
  const pipeline = [];

  // 1) Base scope ($match): org + project-access (from the viewer, not the plan).
  pipeline.push({ $match: catalog.scope(viewerCtx) });

  // 2) addFields() for derived fields referenced by filters/sort (dedup by key).
  const added = new Set();
  referencedKeys(validPlan).forEach((key) => {
    const f = byKey.get(key);
    if (f?.derived && typeof f.addFields === 'function' && !added.has(key)) {
      pipeline.push(...f.addFields());
      added.add(key);
    }
  });

  // 3) Filter $match: AND of each field's toMatch fragment.
  if (validPlan.filters.length) {
    const frags = validPlan.filters.map((flt) =>
      byKey.get(flt.field).toMatch(flt.op, flt.value, viewerCtx),
    );
    pipeline.push({ $match: frags.length === 1 ? frags[0] : { $and: frags } });
  }

  const renderMode = opts.renderMode || 'list';

  // ---- Metric mode --------------------------------------------------------
  if (renderMode === 'metric') {
    const agg = opts.metricConfig?.agg || 'count';
    const field = opts.metricConfig?.field || null;
    if (agg === 'count') {
      const res = await Model.aggregate([...pipeline, { $count: 'value' }]);
      return { value: res[0]?.value || 0, breakdown: [] };
    }
    // sum/avg over a numeric catalog field (near extension per design §3.5).
    if ((agg === 'sum' || agg === 'avg') && field) {
      const accumulator = agg === 'sum' ? { $sum: `$${field}` } : { $avg: `$${field}` };
      const res = await Model.aggregate([
        ...pipeline,
        { $group: { _id: null, value: accumulator } },
      ]);
      return { value: res[0]?.value || 0, breakdown: [] };
    }
    throw new Error(`Unsupported metric aggregation: ${agg}`);
  }

  // ---- List mode ----------------------------------------------------------
  if (validPlan.sort) {
    pipeline.push({ $sort: { [validPlan.sort.field]: validPlan.sort.dir === 'asc' ? 1 : -1 } });
  }

  // Total before limit (clone the scope+derived+filter stages, count them).
  const countPipeline = [...pipeline.filter((s) => !s.$sort), { $count: 'total' }];
  const [countRes, rows] = await Promise.all([
    Model.aggregate(countPipeline),
    Model.aggregate([...pipeline, { $limit: validPlan.limit }]),
  ]);

  return { rows, total: countRes[0]?.total || 0 };
};

export default runQueryPlan;
