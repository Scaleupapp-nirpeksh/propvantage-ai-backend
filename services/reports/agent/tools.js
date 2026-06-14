// File: services/reports/agent/tools.js
// Read-only tools the report agent (Phase 3b) calls to ground its proposals in real
// data. Each takes a ctx = { organization, accessibleProjectIds, userPermissions, isOwner }.
// Pure-ish: they read existing services; they never write.

import mongoose from 'mongoose';
import Project from '../../../models/projectModel.js';
import { getCatalog } from '../blockRegistry.js';
import { resolveReportData } from '../snapshotService.js';

// Mongo filter on the Project collection by _id, honoring the caller's access.
// owner (null) → all; [] → none; else the explicit set. Mirrors utils/projectAccessHelper.
const projectAccessFilter = (accessibleProjectIds) => {
  if (accessibleProjectIds === null || accessibleProjectIds === undefined) return {};
  const ids = accessibleProjectIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  return { _id: { $in: ids } };
};

/** Projects the caller may scope a report to. */
export const listProjects = async (ctx = {}) => {
  const docs = await Project
    .find({ organization: ctx.organization, ...projectAccessFilter(ctx.accessibleProjectIds) })
    .select('name status')
    .lean();
  return docs.map((p) => ({ id: String(p._id), name: p.name, status: p.status }));
};

/** The block palette the caller is permitted to use (metadata only; resolve stripped). */
export const getMetricCatalog = (ctx = {}) => getCatalog(ctx.userPermissions || [], ctx.isOwner || false);

/**
 * Resolve a set of metric (block) ids against a scope/period into REAL numbers, so the
 * agent can ground proposals + write the narrative. Never invents data.
 * @param {{ scope?: object, metricIds?: string[] }} args
 */
export const getDataPreview = async ({ scope = {}, metricIds = [] } = {}, ctx = {}) => {
  const definition = {
    organization: ctx.organization,
    scope,
    blocks: (metricIds || []).map((type) => ({ id: type, type, config: {} })),
  };
  const { blocks } = await resolveReportData(definition, { accessibleProjectIds: ctx.accessibleProjectIds });
  return blocks.map((b) => ({ type: b.type, data: b.data }));
};

export default { listProjects, getMetricCatalog, getDataPreview };
