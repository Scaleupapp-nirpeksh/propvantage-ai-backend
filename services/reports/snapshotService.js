// File: services/reports/snapshotService.js
// Description: Freezes block data into a ReportInstance. buildSnapshotBlocks and
// resolvePeriodArgs are pure; generateInstance is the thin DB wrapper.

import crypto from 'crypto';
import ReportInstance from '../../models/reportInstanceModel.js';
import { getBlock } from './blockRegistry.js';
import { getLeadershipOverview } from '../leadershipDashboardService.js';

/**
 * Resolve every template block against a fetched overview, freezing the result.
 * Pure: no I/O. Unknown types and resolver errors are isolated per block so one
 * bad block never fails the whole report.
 */
export const buildSnapshotBlocks = (templateBlocks, overview = {}) => {
  if (!Array.isArray(templateBlocks)) return [];
  return templateBlocks.map((block) => {
    const def = getBlock(block.type);
    if (!def) return { ...block, data: { error: `Unknown block type: ${block.type}` } };
    try {
      const data = def.resolve({ overview, config: block.config || {} });
      return { ...block, data };
    } catch (err) {
      return { ...block, data: { error: err.message } };
    }
  });
};

const PRESET_TO_PERIOD = {
  last_30d: '30', mtd: '30', last_month: '30',
  qtd: '90', last_quarter: '90',
  ytd: '365',
};

/**
 * Map a template's scope.period onto the (period, startDate, endDate) arguments
 * that getLeadershipOverview expects. Pure.
 */
export const resolvePeriodArgs = (scope = {}) => {
  const p = scope.period || {};
  if (p.preset === 'custom' && p.customStart && p.customEnd) {
    return { period: '30', startDate: p.customStart, endDate: p.customEnd };
  }
  return { period: PRESET_TO_PERIOD[p.preset] || '30', startDate: undefined, endDate: undefined };
};

/**
 * Generate and persist a frozen ReportInstance from a template.
 * @param {Object} template - a ReportTemplate document (or plain object with the same shape)
 * @param {Object} ctx - { createdBy, accessibleProjectIds }
 * @returns {Promise<ReportInstance>}
 */
export const generateInstance = async (template, { createdBy = null, accessibleProjectIds = null } = {}) => {
  const { period, startDate, endDate } = resolvePeriodArgs(template.scope);
  const overview = await getLeadershipOverview(
    template.organization, period, startDate, endDate, accessibleProjectIds
  );
  const blocks = buildSnapshotBlocks(template.blocks, overview);
  const expiresAfterDays = template.access?.expiresAfterDays || 90;

  return ReportInstance.create({
    organization: template.organization,
    template: template._id,
    createdBy,
    title: template.name,
    periodStart: overview?._dateRange?.start,
    periodEnd: overview?._dateRange?.end,
    blocks,
    theme: template.theme,
    images: (template.imageSlots || []).map((s) => ({ id: s.id, label: s.label, url: s.url })),
    publicSlug: crypto.randomBytes(9).toString('base64url'),
    accessToken: crypto.randomBytes(24).toString('base64url'),
    gate: template.access?.gate || 'email',
    expiresAt: new Date(Date.now() + expiresAfterDays * 24 * 60 * 60 * 1000),
  });
};
