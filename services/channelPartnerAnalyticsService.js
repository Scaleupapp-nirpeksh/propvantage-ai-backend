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
  // Top-line Direct-vs-CP split — a CP-sourced sale counts its whole revenue once.
  const salesSplit = await Sale.aggregate([
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
  ]);

  const leadsSplit = await Lead.aggregate([
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

  // Per-firm rows — merge sales + leads aggregations with the partner registry.
  const [salesByPartner, leadsByPartner, partners] = await Promise.all([
    aggregateSalesByPartner({ organization, projectFilter, startDate, endDate }),
    aggregateLeadsByPartner({ organization, projectFilter, startDate, endDate }),
    ChannelPartner.find({ organization }).select('firmName category').lean(),
  ]);

  const salesMap = Object.fromEntries(salesByPartner.map((r) => [String(r._id), r]));
  const leadsMap = Object.fromEntries(leadsByPartner.map((r) => [String(r._id), r]));

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
