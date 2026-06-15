// File: services/reports/blockRegistry.js
// Description: Catalog of report block types. Each block knows how to resolve its
// own data from the existing getLeadershipOverview() snapshot. The report domain
// never re-implements analytics — it only selects/transforms.

import { objectMapToChartData, num } from './blockHelpers.js';
import { buildFacts, generateNarrative } from './narrativeService.js';

const ADV = 'analytics:advanced'; // gate for data-bearing blocks

// kind: 'kpi' | 'chart' | 'table' | 'layout'
// requiredPermission: a permission string, or null for always-available layout blocks.
// NOTE: `kind` is the RENDERING family used by the public page / builder:
//   'kpi' | 'chart' | 'table' | 'layout'.
// 'layout' is the presentational family and intentionally spans several
// descriptive `type` namespaces — layout.* , media.* , text.* — all of which
// render as non-data presentational blocks. So a block's `type` prefix does NOT
// have to equal its `kind` (only kpi/chart/table happen to line up 1:1).
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
    resolve: ({ overview }) => ({
      columns: [
        { key: 'name', label: 'Team member', unit: 'text' },
        { key: 'openTasks', label: 'Open tasks', unit: 'count' },
      ],
      rows: Array.isArray(overview?.team?.topWorkload) ? overview.team.topWorkload : [],
    }),
  },
  // ─── AI ─────────────────────────────────────────────
  {
    type: 'ai.narrative', category: 'AI', label: 'AI Narrative', kind: 'narrative',
    description: 'An AI-written executive summary of this report’s figures.',
    requiredPermission: 'ai:insights', defaultConfig: { focus: '' },
    resolve: async ({ overview, config }) => generateNarrative(buildFacts(overview), config?.focus),
  },
  // ─── Financial (extra) ──────────────────────────────
  {
    type: 'kpi.totalSalesCount', category: 'Financial', label: 'Bookings', kind: 'kpi',
    description: 'Number of bookings (all-time).', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.totalSalesCount), unit: 'count' }),
  },
  {
    type: 'kpi.overdueAmount', category: 'Financial', label: 'Overdue', kind: 'kpi',
    description: 'Total overdue receivables.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.revenue?.totalOverdue), unit: 'currency' }),
  },
  // ─── Invoicing ──────────────────────────────────────
  {
    type: 'kpi.invoiced', category: 'Invoicing', label: 'Total Invoiced', kind: 'kpi',
    description: 'Total invoiced amount.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.invoicing?.totalInvoiced), unit: 'currency' }),
  },
  {
    type: 'kpi.invoicePaid', category: 'Invoicing', label: 'Invoices Paid', kind: 'kpi',
    description: 'Total paid against invoices.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.invoicing?.totalPaid), unit: 'currency' }),
  },
  {
    type: 'kpi.invoiceOverdue', category: 'Invoicing', label: 'Invoices Overdue', kind: 'kpi',
    description: 'Overdue invoice amount.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.invoicing?.totalOverdue), unit: 'currency' }),
  },
  {
    type: 'chart.invoicesByStatus', category: 'Invoicing', label: 'Invoices by Status', kind: 'chart',
    description: 'Invoice count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'bar', data: objectMapToChartData(overview?.invoicing?.invoicesByStatus) }),
  },
  // ─── Channel Partners ───────────────────────────────
  {
    type: 'kpi.cpGrossCommissions', category: 'Channel Partners', label: 'Gross Commissions', kind: 'kpi',
    description: 'Total gross channel-partner commissions.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.channelPartner?.totalGrossCommissions), unit: 'currency' }),
  },
  {
    type: 'kpi.cpNetCommissions', category: 'Channel Partners', label: 'Net Commissions', kind: 'kpi',
    description: 'Total net channel-partner commissions.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.channelPartner?.totalNetCommissions), unit: 'currency' }),
  },
  {
    type: 'kpi.cpPendingCommissions', category: 'Channel Partners', label: 'Pending Commissions', kind: 'kpi',
    description: 'Commissions pending payout.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.channelPartner?.totalPending), unit: 'currency' }),
  },
  {
    type: 'table.cpCommissionsByStatus', category: 'Channel Partners', label: 'Commissions by Status', kind: 'table',
    description: 'Commission count and amount by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({
      columns: [
        { key: 'status', label: 'Status', unit: 'text' },
        { key: 'count', label: 'Count', unit: 'count' },
        { key: 'amount', label: 'Amount', unit: 'currency' },
      ],
      rows: Object.entries(overview?.channelPartner?.commissionsByStatus || {})
        .map(([status, v]) => ({ status, count: num(v?.count), amount: num(v?.amount) })),
    }),
  },
  // ─── Construction ───────────────────────────────────
  {
    type: 'kpi.constructionProgress', category: 'Construction', label: 'Construction Progress', kind: 'kpi',
    description: 'Average construction progress across milestones.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.construction?.overallProgress) / 100, unit: 'percent' }),
  },
  {
    type: 'kpi.delayedMilestones', category: 'Construction', label: 'Delayed Milestones', kind: 'kpi',
    description: 'Count of delayed construction milestones.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.construction?.delayedCount), unit: 'count' }),
  },
  {
    type: 'chart.milestonesByStatus', category: 'Construction', label: 'Milestones by Status', kind: 'chart',
    description: 'Milestone count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'pie', data: objectMapToChartData(overview?.construction?.milestonesByStatus) }),
  },
  // ─── Operations ─────────────────────────────────────
  {
    type: 'kpi.overdueTasks', category: 'Operations', label: 'Overdue Tasks', kind: 'kpi',
    description: 'Tasks past their due date.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ value: num(overview?.operations?.overdueCount), unit: 'count' }),
  },
  {
    type: 'chart.tasksByStatus', category: 'Operations', label: 'Tasks by Status', kind: 'chart',
    description: 'Task count by status.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'pie', data: objectMapToChartData(overview?.operations?.tasksByStatus) }),
  },
  {
    type: 'chart.tasksByPriority', category: 'Operations', label: 'Tasks by Priority', kind: 'chart',
    description: 'Task count by priority.', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({ chartKind: 'bar', data: objectMapToChartData(overview?.operations?.tasksByPriority) }),
  },
  // ─── Comparison (compare scope) ─────────────────────
  {
    type: 'table.projectComparison', category: 'Comparison', label: 'Project Comparison', kind: 'table',
    description: 'Side-by-side key metrics per project (used with a "compare" scope).', requiredPermission: ADV, defaultConfig: {},
    resolve: ({ overview }) => ({
      columns: [
        { key: 'project', label: 'Project', unit: 'text' },
        { key: 'sales', label: 'Sales', unit: 'currency' },
        { key: 'collected', label: 'Collected', unit: 'currency' },
        { key: 'conversion', label: 'Conversion', unit: 'percent' },
        { key: 'progress', label: 'Progress', unit: 'percent' },
      ],
      rows: (overview?._comparison?.projects || []).map((p) => ({
        project: p?.name,
        sales: num(p?.revenue?.actualRevenue),
        collected: num(p?.revenue?.totalCollected),
        conversion: num(p?.salesPipeline?.conversionRate),
        // overallProgress is 0–100; normalize to a fraction so 'percent' formatting matches the KPIs.
        progress: num(p?.construction?.overallProgress) / 100,
      })),
    }),
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
Object.freeze(BLOCKS);

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
