// File: services/workspace/queryEngine.js
// Description: The Workspace query engine. Compiles a validated Query Plan into a
// Mongo aggregation pipeline, ALWAYS re-scoped to the viewer (org +
// accessibleProjectIds via catalog.scope), and runs it in list or metric mode.
//
//   runQueryPlan(plan, viewerCtx)                                   -> { rows, total }
//   runQueryPlan(plan, viewerCtx, { renderMode:'metric', metricConfig }) -> { value, breakdown }
//
// Security: scoping is taken from viewerCtx (built from the authenticated req in
// the controller), NEVER from the plan. Derived fields referenced by filters/sort
// are materialised before the filter $match. Displayable derived fields and ref
// fields are additionally materialised in the rows pipeline (after the filter
// $match) so display columns always populate; the count pipeline skips this for
// efficiency and correctness.

import mongoose from 'mongoose';
import { validateQueryPlan } from './queryPlanSchema.js';
import { getCatalog } from './catalogs/index.js';

/** Build a field-key -> FieldDescriptor lookup for a catalog. */
const indexFields = (catalog) => {
  const map = new Map();
  catalog.fields.forEach((f) => map.set(f.key, f));
  return map;
};

/** Keys referenced by the plan's filters + sort (the only derived fields we add before $match). */
const referencedKeys = (plan) => {
  const keys = new Set(plan.filters.map((f) => f.field));
  if (plan.sort?.field) keys.add(plan.sort.field);
  return keys;
};

/**
 * Build aggregation stages that materialise displayable derived fields and
 * resolve ref fields to human-readable labels. These run AFTER the filter
 * $match in the rows pipeline only (never in count or metric pipelines).
 *
 * @param {import('./catalogs/index.js').FieldDescriptor[]} fields All catalog fields.
 * @param {Set<string>} alreadyAdded Keys already materialised before the filter $match.
 * @returns {object[]} Additional aggregation stages.
 */
const buildDisplayStages = (fields, alreadyAdded) => {
  const stages = [];
  for (const f of fields) {
    if (!f.displayable) continue;

    // Fix 1: materialise displayable derived fields not yet added.
    if (f.derived && typeof f.addFields === 'function' && !alreadyAdded.has(f.key)) {
      const result = f.addFields();
      // addFields() may return a single stage object or an array of stages.
      if (Array.isArray(result)) {
        stages.push(...result);
      } else {
        stages.push(result);
      }
    }

    // Fix: resolve ARRAY ref fields (e.g. a lead's multiple CP firms/agents) to a joined label.
    if (f.type === 'ref' && f.refArray && f.refPath) {
      const coll = mongoose.model(f.refModel).collection.collectionName;
      const docsAlias = `__${f.key}_docs`;                 // __-prefixed → stripped by final cleanup
      const labelFields = f.refLabelFields || ['name'];
      const perDoc = {
        $trim: {
          input: {
            $reduce: {
              input: labelFields.map((lf) => ({ $ifNull: [`$$d.${lf}`, ''] })),
              initialValue: '',
              in: { $concat: ['$$value', ' ', '$$this'] },
            },
          },
        },
      };
      stages.push(
        { $lookup: { from: coll, localField: f.refPath, foreignField: '_id', as: docsAlias } },
        {
          $addFields: {
            [`${f.key}_label`]: {
              $trim: {
                input: {
                  $reduce: {
                    input: { $map: { input: `$${docsAlias}`, as: 'd', in: perDoc } },
                    initialValue: '',
                    in: {
                      $cond: [
                        { $eq: ['$$value', ''] },
                        '$$this',
                        { $concat: ['$$value', ', ', '$$this'] },
                      ],
                    },
                  },
                },
              },
            },
          },
        },
      );
      continue; // handled as an array ref; skip the single-ref branch below
    }

    // Fix 2: resolve ref fields to human-readable label via $lookup.
    if (f.type === 'ref' && f.refModel && !f.refArray) {
      const coll = mongoose.model(f.refModel).collection.collectionName;
      const docAlias = `__${f.key}_doc`;          // starts with __ → stripped by final strip
      const labelFields = f.refLabelFields || ['name'];
      const dParts = labelFields.map((lf) => ({ $ifNull: [`$$d.${lf}`, ''] }));

      stages.push(
        { $lookup: { from: coll, localField: f.key, foreignField: '_id', as: docAlias } },
        {
          $addFields: {
            [`${f.key}_label`]: {
              $let: {
                vars: { d: { $arrayElemAt: [`$${docAlias}`, 0] } },
                in: {
                  $trim: {
                    input: {
                      $reduce: {
                        input: dParts,
                        initialValue: '',
                        in: { $concat: ['$$value', ' ', '$$this'] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      );
    }
  }
  return stages;
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
  const refKeys = referencedKeys(validPlan);
  refKeys.forEach((key) => {
    if (!byKey.has(key)) throw new Error(`Unknown field for module ${validPlan.module}: ${key}`);
  });

  const Model = mongoose.model(catalog.baseModel);

  // Build the shared base pipeline: scope + filter-referenced derived addFields + filter $match.
  const pipeline = [];

  // 1) Base scope ($match): org + project-access (from the viewer, not the plan).
  const baseMatch = catalog.scope(viewerCtx);
  // Global project switcher: if the viewer selected one project, narrow to it —
  // but ONLY if it is within their access (owner, or in accessibleProjectIds).
  // This can only ever narrow the access scope, never widen it.
  const pid = viewerCtx.scopeProjectId;
  if (pid && catalog.projectField) {
    const allowed =
      viewerCtx.isOwner ||
      viewerCtx.accessibleProjectIds == null ||
      (viewerCtx.accessibleProjectIds || []).map(String).includes(String(pid));
    if (allowed) {
      try {
        baseMatch[catalog.projectField] = new mongoose.Types.ObjectId(String(pid));
      } catch {
        /* malformed id → ignore the selection, keep the access scope */
      }
    }
  }
  pipeline.push({ $match: baseMatch });

  // 2) addFields() for derived fields referenced by filters/sort (dedup by key).
  //    These MUST run before the filter $match so filtering on a derived field works.
  const added = new Set();
  refKeys.forEach((key) => {
    const f = byKey.get(key);
    if (f?.derived && typeof f.addFields === 'function' && !added.has(key)) {
      const result = f.addFields();
      if (Array.isArray(result)) {
        pipeline.push(...result);
      } else {
        pipeline.push(result);
      }
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
    if (agg === 'sum' || agg === 'avg') {
      if (!field) throw new Error(`Metric aggregation '${agg}' requires a field`);
      if (!byKey.has(field)) throw new Error(`Unknown field for module ${validPlan.module}: ${field}`);
      const accumulator = agg === 'sum' ? { $sum: `$${field}` } : { $avg: `$${field}` };
      const res = await Model.aggregate([...pipeline, { $group: { _id: null, value: accumulator } }]);
      return { value: res[0]?.value || 0, breakdown: [] };
    }
    throw new Error(`Unsupported metric aggregation: ${agg}`);
  }

  // ---- List mode ----------------------------------------------------------
  // Count pipeline: scope + filter-referenced-derived + filter $match + $count.
  // Intentionally omits display stages and sort (cheap and correct).
  const countPipeline = [...pipeline, { $count: 'total' }];

  // Display stages: materialise remaining displayable derived fields + ref lookups.
  // Run AFTER the filter $match so they don't affect count or filter semantics.
  const displayStages = buildDisplayStages(catalog.fields, added);

  // Rows pipeline: base + display + sort + limit.
  const sortStage = validPlan.sort
    ? [{ $sort: { [validPlan.sort.field]: validPlan.sort.dir === 'asc' ? 1 : -1 } }]
    : [];
  const rowsPipeline = [...pipeline, ...displayStages, ...sortStage, { $limit: validPlan.limit }];

  const [countRes, rows] = await Promise.all([
    Model.aggregate(countPipeline),
    Model.aggregate(rowsPipeline),
  ]);

  // Strip internal temp fields (convention: derived catalog stages prefix
  // intermediate values with "__") so they never leak into API responses.
  for (const row of rows) {
    for (const k of Object.keys(row)) if (k.startsWith('__')) delete row[k];
  }
  return { rows, total: countRes[0]?.total || 0 };
};

export default runQueryPlan;
