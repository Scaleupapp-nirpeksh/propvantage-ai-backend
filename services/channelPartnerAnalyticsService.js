// File: services/channelPartnerAnalyticsService.js
// Description: Aggregation pipelines for Channel Partner analytics — Direct-vs-CP
//   volume and commission breakdowns. Consumed by the analytics web endpoints and
//   by the AI copilot tools. Every pipeline is organization-scoped.

import mongoose from 'mongoose';
import Sale from '../models/salesModel.js';
import Lead from '../models/leadModel.js';
import ChannelPartner from '../models/channelPartnerModel.js';
import CommissionRecord from '../models/commissionRecordModel.js';

const CATEGORIES = ['broker_firm', 'individual_agent', 'corporate', 'digital_aggregator'];

// Safe division — returns 0 instead of NaN/Infinity when the denominator is 0.
const safeDiv = (a, b) => (b > 0 ? a / b : 0);

// Build a date-range match fragment for `field`, or {} when no range is given.
const dateMatch = (field, startDate, endDate) =>
  startDate && endDate ? { [field]: { $gte: startDate, $lte: endDate } } : {};

/**
 * Per-channel-partner sales aggregation: deals involved in + revenue apportioned
 * by sharePct. Used by both getVolumeBreakdown and getCommissionBreakdown.
 * Returns: [{ _id: channelPartnerObjectId, sales, revenue }]
 */
const aggregateSalesByPartner = ({ organization, projectFilter, startDate, endDate }) =>
  Sale.aggregate([
    {
      $match: {
        organization,
        status: { $ne: 'Cancelled' },
        'channelPartnerAttribution.viaChannelPartner': true,
        ...projectFilter,
        ...dateMatch('bookingDate', startDate, endDate),
      },
    },
    { $unwind: '$channelPartnerAttribution.partners' },
    // Dedupe per (sale, CP) so a CP listed twice in one split is counted once.
    {
      $group: {
        _id: { sale: '$_id', cp: '$channelPartnerAttribution.partners.channelPartner' },
        salePrice: { $first: '$salePrice' },
        sharePct: { $sum: { $ifNull: ['$channelPartnerAttribution.partners.sharePct', 0] } },
      },
    },
    {
      $group: {
        _id: '$_id.cp',
        sales: { $sum: 1 },
        revenue: {
          $sum: {
            $multiply: ['$salePrice', { $divide: [{ $min: ['$sharePct', 100] }, 100] }],
          },
        },
      },
    },
  ]);

/**
 * Per-channel-partner lead aggregation: leads tagged to each CP.
 * Returns: [{ _id: channelPartnerObjectId, leads }]
 */
const aggregateLeadsByPartner = ({ organization, projectFilter, startDate, endDate }) =>
  Lead.aggregate([
    {
      $match: {
        organization,
        'channelPartnerAttribution.viaChannelPartner': true,
        ...projectFilter,
        ...dateMatch('createdAt', startDate, endDate),
      },
    },
    { $unwind: '$channelPartnerAttribution.partners' },
    { $group: { _id: { lead: '$_id', cp: '$channelPartnerAttribution.partners.channelPartner' } } },
    { $group: { _id: '$_id.cp', leads: { $sum: 1 } } },
  ]);

/**
 * Direct-vs-CP volume breakdown for the given org/project/date scope.
 * @param {Object} args
 * @param {ObjectId} args.organization
 * @param {Object} args.projectFilter - mongo fragment for the `project` field ({} = all)
 * @param {Date|null} args.startDate
 * @param {Date|null} args.endDate
 */
export const getVolumeBreakdown = async ({ organization, projectFilter = {}, startDate = null, endDate = null }) => {
  // All five queries are independent — run them concurrently.
  // salesSplit / leadsSplit: top-line Direct-vs-CP split (whole revenue per sale).
  // aggregateSalesByPartner / aggregateLeadsByPartner / ChannelPartner.find:
  //   per-firm data merged below into byFirm / byCategory.
  const [
    salesSplit,
    leadsSplit,
    salesByPartner,
    leadsByPartner,
    partners,
  ] = await Promise.all([
    Sale.aggregate([
      {
        $match: {
          organization,
          status: { $ne: 'Cancelled' },
          ...projectFilter,
          ...dateMatch('bookingDate', startDate, endDate),
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$channelPartnerAttribution.viaChannelPartner', false] },
          count: { $sum: 1 },
          revenue: { $sum: '$salePrice' },
        },
      },
    ]),
    Lead.aggregate([
      {
        $match: {
          organization,
          ...projectFilter,
          ...dateMatch('createdAt', startDate, endDate),
        },
      },
      {
        $group: {
          _id: { $ifNull: ['$channelPartnerAttribution.viaChannelPartner', false] },
          count: { $sum: 1 },
        },
      },
    ]),
    aggregateSalesByPartner({ organization, projectFilter, startDate, endDate }),
    aggregateLeadsByPartner({ organization, projectFilter, startDate, endDate }),
    ChannelPartner.find({ organization }).select('firmName category').lean(),
  ]);

  const pickSplit = (rows, viaValue) => rows.find((r) => r._id === viaValue) || {};
  const cpSales = pickSplit(salesSplit, true);
  const directSales = pickSplit(salesSplit, false);
  const cpLeads = pickSplit(leadsSplit, true);
  const directLeads = pickSplit(leadsSplit, false);

  const sales = {
    direct: { count: directSales.count || 0, revenue: directSales.revenue || 0 },
    channelPartner: { count: cpSales.count || 0, revenue: cpSales.revenue || 0 },
  };
  sales.total = {
    count: sales.direct.count + sales.channelPartner.count,
    revenue: sales.direct.revenue + sales.channelPartner.revenue,
  };
  sales.cpSharePct = Math.round(safeDiv(sales.channelPartner.revenue, sales.total.revenue) * 100);

  const leads = {
    direct: { count: directLeads.count || 0 },
    channelPartner: { count: cpLeads.count || 0 },
  };
  leads.total = { count: leads.direct.count + leads.channelPartner.count };
  leads.cpSharePct = Math.round(safeDiv(leads.channelPartner.count, leads.total.count) * 100);

  const conversion = {
    direct: Math.round(safeDiv(sales.direct.count, leads.direct.count) * 100),
    channelPartner: Math.round(safeDiv(sales.channelPartner.count, leads.channelPartner.count) * 100),
  };
  const avgDealSize = {
    direct: Math.round(safeDiv(sales.direct.revenue, sales.direct.count)),
    channelPartner: Math.round(safeDiv(sales.channelPartner.revenue, sales.channelPartner.count)),
  };

  const salesMap = Object.fromEntries(salesByPartner.map((r) => [String(r._id), r]));
  const leadsMap = Object.fromEntries(leadsByPartner.map((r) => [String(r._id), r]));

  // Per-firm and per-category revenue is apportioned by each partner's `sharePct`.
  // This reconciles to the top-line `sales.channelPartner.revenue` (which counts each
  // CP-sourced sale's whole `salePrice` once) ONLY when each sale's partner shares sum
  // to 100. The `sharePct` field is 0..100 per the schema; malformed data where shares
  // don't sum to 100 will make per-firm totals diverge from the top-line. This is an
  // accepted limitation — per-firm figures are best-effort attributions.
  const byFirm = partners
    .map((p) => {
      const id = String(p._id);
      const s = salesMap[id] || {};
      const l = leadsMap[id] || {};
      const firmSales = s.sales || 0;
      const firmLeads = l.leads || 0;
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        category: p.category || 'broker_firm',
        leads: firmLeads,
        sales: firmSales,
        revenue: Math.round(s.revenue || 0),
        conversionPct: Math.round(safeDiv(firmSales, firmLeads) * 100),
      };
    })
    .filter((r) => r.leads > 0 || r.sales > 0)
    .sort((a, b) => b.revenue - a.revenue);

  // Category roll-up — always 4 rows, zero-filled, derived from byFirm.
  const byCategory = CATEGORIES.map((category) => {
    const rows = byFirm.filter((r) => r.category === category);
    return {
      category,
      leads: rows.reduce((n, r) => n + r.leads, 0),
      sales: rows.reduce((n, r) => n + r.sales, 0),
      revenue: rows.reduce((n, r) => n + r.revenue, 0),
    };
  });

  return { sales, leads, conversion, avgDealSize, byCategory, byFirm };
};

/**
 * Commission + payment-status breakdown for the given org/project/date scope.
 * Same args as getVolumeBreakdown.
 */
export const getCommissionBreakdown = async ({ organization, projectFilter = {}, startDate = null, endDate = null }) => {
  // CommissionRecord has no `project` field — project scope is applied via the
  // linked Sale. A `paidAmount` field is derived from the paid payouts.
  const buildPipeline = (groupStage) => {
    const pipeline = [
      {
        $match: {
          organization,
          status: { $ne: 'cancelled' },
          ...dateMatch('createdAt', startDate, endDate),
        },
      },
    ];
    if (projectFilter.project) {
      // The sale $lookup is repeated across the three aggregations when a project filter is active — acceptable for current data volumes; revisit with $facet if it becomes a hotspot.
      pipeline.push(
        { $lookup: { from: 'sales', localField: 'sale', foreignField: '_id', as: 'saleDoc' } },
        // Intentional: without the sale, the record's project cannot be determined, so it is dropped from project-scoped results.
        { $unwind: { path: '$saleDoc', preserveNullAndEmptyArrays: false } },
        { $match: { 'saleDoc.project': projectFilter.project } }
      );
    }
    pipeline.push({
      $addFields: {
        paidAmount: {
          $sum: {
            $map: {
              input: { $filter: { input: '$payouts', as: 'p', cond: { $eq: ['$$p.status', 'paid'] } } },
              as: 'p',
              in: '$$p.amount',
            },
          },
        },
      },
    });
    pipeline.push(groupStage);
    return pipeline;
  };

  // All five queries are independent — run them concurrently.
  const [
    summaryRows,
    statusRows,
    firmRows,
    salesByPartner,
    partners,
  ] = await Promise.all([
    // Org-wide summary.
    CommissionRecord.aggregate(
      buildPipeline({
        $group: {
          _id: null,
          grossAccrued: { $sum: '$grossAmount' },
          tds: { $sum: '$tdsAmount' },
          netAccrued: { $sum: '$netAmount' },
          paid: { $sum: '$paidAmount' },
        },
      })
    ),
    // Payment status — count + net amount per CommissionRecord.status. Note the
    // status:{$ne:'cancelled'} match means 'cancelled' never appears here, which
    // is the intended behaviour for the analytics view.
    CommissionRecord.aggregate(
      buildPipeline({
        $group: { _id: '$status', count: { $sum: 1 }, netAmount: { $sum: '$netAmount' } },
      })
    ),
    // Per-firm commission.
    CommissionRecord.aggregate(
      buildPipeline({
        $group: {
          _id: '$channelPartner',
          netCommission: { $sum: '$netAmount' },
          paid: { $sum: '$paidAmount' },
        },
      })
    ),
    // CP-sourced booked revenue per firm — reuse the volume helper for ranking.
    aggregateSalesByPartner({ organization, projectFilter, startDate, endDate }),
    ChannelPartner.find({ organization }).select('firmName category').lean(),
  ]);

  const s = summaryRows[0] || { grossAccrued: 0, tds: 0, netAccrued: 0, paid: 0 };
  const summary = {
    grossAccrued: Math.round(s.grossAccrued),
    tds: Math.round(s.tds),
    netAccrued: Math.round(s.netAccrued),
    paid: Math.round(s.paid),
    pending: Math.max(0, Math.round(s.netAccrued - s.paid)),
  };

  const paymentStatus = statusRows.map((r) => ({
    status: r._id,
    count: r.count,
    netAmount: Math.round(r.netAmount),
  }));

  const revenueMap = Object.fromEntries(salesByPartner.map((r) => [String(r._id), r.revenue || 0]));
  const commMap = Object.fromEntries(firmRows.map((r) => [String(r._id), r]));

  const byFirm = partners
    .map((p) => {
      const id = String(p._id);
      const c = commMap[id] || {};
      const net = Math.round(c.netCommission || 0);
      const paid = Math.round(c.paid || 0);
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        category: p.category || 'broker_firm',
        netCommission: net,
        paid,
        pending: Math.max(0, net - paid),
      };
    })
    .filter((r) => r.netCommission > 0)
    .sort((a, b) => b.netCommission - a.netCommission);

  const cpRevenueTotal = salesByPartner.reduce((n, r) => n + (r.revenue || 0), 0);
  const effectiveCommissionRate =
    Math.round(safeDiv(summary.netAccrued, cpRevenueTotal) * 1000) / 10; // one decimal %

  const topPerformers = partners
    .map((p) => {
      const id = String(p._id);
      return {
        channelPartnerId: p._id,
        firmName: p.firmName,
        category: p.category || 'broker_firm',
        bookedRevenue: Math.round(revenueMap[id] || 0),
        netCommission: Math.round((commMap[id] || {}).netCommission || 0),
      };
    })
    .filter((r) => r.bookedRevenue > 0)
    .sort((a, b) => b.bookedRevenue - a.bookedRevenue)
    .slice(0, 10);

  return { summary, paymentStatus, effectiveCommissionRate, byFirm, topPerformers };
};
