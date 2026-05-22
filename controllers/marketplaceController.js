// File: controllers/marketplaceController.js
// Description: Marketplace discovery (SP3) — a CP browses developer organizations
//   and their published portfolios; a developer browses the directory of
//   channel-partner organizations. Read-only; the apply / invite actions live in
//   partnershipController.js.

import asyncHandler from 'express-async-handler';
import Organization from '../models/organizationModel.js';
import Project from '../models/projectModel.js';
import Partnership from '../models/partnershipModel.js';

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clampLimit = (v) => Math.min(Math.max(parseInt(v, 10) || 20, 1), 100);

// GET /api/marketplace/developers — a CP browses developers with published portfolios.
// Gated by requireOrgType('channel_partner') + cp_partnerships:view (route middleware).
export const browseDevelopers = asyncHandler(async (req, res) => {
  const { q, city, projectType, projectStatus, priceMin, priceMax } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = clampLimit(req.query.limit);

  // 1. Match published projects against the project-level filters.
  const projMatch = { 'portfolio.isPublished': true };
  if (projectType) projMatch.type = projectType;
  if (projectStatus) projMatch.status = projectStatus;
  if (city) projMatch['location.city'] = new RegExp(`^${escapeRegex(city)}$`, 'i');
  if (priceMin !== undefined && priceMin !== '') projMatch['priceRange.max'] = { $gte: Number(priceMin) };
  if (priceMax !== undefined && priceMax !== '') projMatch['priceRange.min'] = { $lte: Number(priceMax) };

  const grouped = await Project.aggregate([
    { $match: projMatch },
    {
      $group: {
        _id: '$organization',
        publishedProjectCount: { $sum: 1 },
        projectTypes: { $addToSet: '$type' },
      },
    },
  ]);

  if (grouped.length === 0) {
    return res.json({ success: true, data: { developers: [], total: 0, page, limit } });
  }

  const statsByOrg = new Map(grouped.map((g) => [String(g._id), g]));
  const candidateIds = grouped.map((g) => g._id);

  // 2. Load the matching builder orgs (optionally org-name filtered).
  const orgFilter = { _id: { $in: candidateIds }, type: 'builder', isActive: true };
  if (q) orgFilter.name = new RegExp(escapeRegex(q), 'i');
  const orgs = await Organization.find(orgFilter)
    .select('name city portfolioProfile')
    .sort({ name: 1 })
    .lean();

  // 3. Partnership status between the calling CP and each developer.
  const partnerships = await Partnership.find({
    channelPartnerOrg: req.user.organization,
    developerOrg: { $in: orgs.map((o) => o._id) },
  })
    .select('developerOrg status')
    .lean();
  const statusByDev = new Map(partnerships.map((p) => [String(p.developerOrg), p.status]));

  const all = orgs.map((o) => {
    const stats = statsByOrg.get(String(o._id)) || {};
    return {
      organizationId: o._id,
      name: o.name,
      city: o.city,
      logoUrl: o.portfolioProfile?.logoUrl || null,
      about: o.portfolioProfile?.about || '',
      publishedProjectCount: stats.publishedProjectCount || 0,
      projectTypes: stats.projectTypes || [],
      partnershipStatus: statusByDev.get(String(o._id)) || 'none',
    };
  });
  const paged = all.slice((page - 1) * limit, page * limit);
  res.json({ success: true, data: { developers: paged, total: all.length, page, limit } });
});

// GET /api/marketplace/channel-partners — a developer browses the CP directory.
// Gated by requireOrgType('builder') + channel_partners:view (route middleware).
export const browseChannelPartners = asyncHandler(async (req, res) => {
  const { q, category, area } = req.query;
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = clampLimit(req.query.limit);

  const filter = { type: 'channel_partner', isActive: true };
  if (q) filter.name = new RegExp(escapeRegex(q), 'i');
  if (category) filter.category = category;
  if (area) filter['channelPartnerProfile.areasServed'] = new RegExp(escapeRegex(area), 'i');

  const total = await Organization.countDocuments(filter);
  const orgs = await Organization.find(filter)
    .select('name city category channelPartnerProfile')
    .sort({ name: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  const partnerships = await Partnership.find({
    developerOrg: req.user.organization,
    channelPartnerOrg: { $in: orgs.map((o) => o._id) },
  })
    .select('channelPartnerOrg status')
    .lean();
  const statusByCp = new Map(partnerships.map((p) => [String(p.channelPartnerOrg), p.status]));

  const channelPartners = orgs.map((o) => ({
    organizationId: o._id,
    name: o.name,
    city: o.city,
    category: o.category,
    logoUrl: o.channelPartnerProfile?.logoUrl || null,
    about: o.channelPartnerProfile?.about || '',
    areasServed: o.channelPartnerProfile?.areasServed || [],
    trackRecord: o.channelPartnerProfile?.trackRecord || '',
    partnershipStatus: statusByCp.get(String(o._id)) || 'none',
  }));
  res.json({ success: true, data: { channelPartners, total, page, limit } });
});
