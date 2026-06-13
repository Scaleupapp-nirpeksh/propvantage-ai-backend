// File: services/reports/blockRegistry.js
// Description: Catalog of report block types. Each block knows how to resolve its
// own data from the existing getLeadershipOverview() snapshot. The report domain
// never re-implements analytics — it only selects/transforms.

import { objectMapToChartData, num } from './blockHelpers.js';

const ADV = 'analytics:advanced'; // gate for data-bearing blocks

// kind: 'kpi' | 'chart' | 'table' | 'layout'
// requiredPermission: a permission string, or null for always-available layout blocks.
const BLOCKS = [
  // ─── KPIs (Financial) ───────────────────────────────
  {
    type: 'kpi.revenue', category: 'Financial', label: 'Total Sales Value', kind: 'kpi',
    description: 'Total booked sales value for the period.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.totalSalesValue), unit: 'currency' }),
  },
  {
    type: 'kpi.collections', category: 'Financial', label: 'Collected', kind: 'kpi',
    description: 'Total amount collected.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.totalCollected), unit: 'currency' }),
  },
  {
    type: 'kpi.outstanding', category: 'Financial', label: 'Outstanding', kind: 'kpi',
    description: 'Total outstanding receivables.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.totalOutstanding), unit: 'currency' }),
  },
  {
    type: 'kpi.collectionRate', category: 'Financial', label: 'Collection Rate', kind: 'kpi',
    description: 'Collected ÷ total sales value.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.collectionRate), unit: 'percent' }),
  },
  // ─── KPIs (Sales) ───────────────────────────────────
  {
    type: 'kpi.totalLeads', category: 'Sales', label: 'Total Leads', kind: 'kpi',
    description: 'Total leads in scope.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.salesPipeline?.totalLeads), unit: 'count' }),
  },
  {
    type: 'kpi.conversionRate', category: 'Sales', label: 'Conversion Rate', kind: 'kpi',
    description: 'Booked ÷ total leads.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.salesPipeline?.conversionRate), unit: 'percent' }),
  },
  {
    type: 'kpi.avgBookingValue', category: 'Sales', label: 'Avg Booking Value', kind: 'kpi',
    description: 'Average value per booking.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.salesPipeline?.avgBookingValue), unit: 'currency' }),
  },
  // ─── Charts ─────────────────────────────────────────
  {
    type: 'chart.unitsByStatus', category: 'Inventory', label: 'Inventory by Status', kind: 'chart',
    description: 'Unit count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'pie', data: objectMapToChartData(overview?.portfolio?.unitsByStatus) }),
  },
  {
    type: 'chart.leadsByStatus', category: 'Sales', label: 'Lead Funnel', kind: 'chart',
    description: 'Lead count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'bar', data: objectMapToChartData(overview?.salesPipeline?.leadsByStatus) }),
  },
  {
    type: 'chart.leadsBySource', category: 'Sales', label: 'Lead Sources', kind: 'chart',
    description: 'Lead count by source.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'pie', data: objectMapToChartData(overview?.salesPipeline?.leadsBySource) }),
  },
  // ─── Tables ─────────────────────────────────────────
  {
    type: 'table.topWorkload', category: 'Team', label: 'Team Workload', kind: 'table',
    description: 'Users with the most open tasks.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ rows: Array.isArray(overview?.team?.topWorkload) ? overview.team.topWorkload : [] }),
  },
  // ─── Layout / Media (always available) ──────────────
  {
    type: 'layout.hero', category: 'Layout', label: 'Cover / Hero', kind: 'layout',
    description: 'Cover image with title and subtitle.', requiredPermission: null,
    defaultConfig: { title: '', subtitle: '', imageSlotId: null },
    resolve: ({ config = {} }) => ({ title: config.title || '', subtitle: config.subtitle || '', imageSlotId: config.imageSlotId || null }),
  },
  {
    type: 'media.gallery', category: 'Layout', label: 'Image Gallery', kind: 'layout',
    description: 'A grid of project images.', requiredPermission: null,
    defaultConfig: { imageSlotIds: [] },
    resolve: ({ config = {} }) => ({ imageSlotIds: Array.isArray(config.imageSlotIds) ? config.imageSlotIds : [] }),
  },
  {
    type: 'text.note', category: 'Layout', label: 'Text Note', kind: 'layout',
    description: 'A free-text paragraph.', requiredPermission: null, defaultConfig: { text: '' },
    resolve: ({ config = {} }) => ({ text: config.text || '' }),
  },
  {
    type: 'layout.divider', category: 'Layout', label: 'Divider', kind: 'layout',
    description: 'A horizontal section divider.', requiredPermission: null, defaultConfig: {},
    resolve: () => ({}),
  },
];

const BLOCK_MAP = new Map(BLOCKS.map((b) => [b.type, b]));

/** Look up a block definition by type. */
export const getBlock = (type) => BLOCK_MAP.get(type);

/**
 * Catalog for the builder UI: metadata only (resolve stripped), filtered to the
 * blocks this user may use. Owners see everything; otherwise the user must hold
 * the block's requiredPermission (null = always available).
 */
export const getCatalog = (userPermissions = [], isOwner = false) =>
  BLOCKS
    .filter((b) => !b.requiredPermission || isOwner || userPermissions.includes(b.requiredPermission))
    .map(({ resolve, ...meta }) => meta);

export { BLOCKS };
