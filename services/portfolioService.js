// File: services/portfolioService.js
// Description: Assembles a developer's curated public portfolio — org profile +
//   published projects + a live per-configuration unit summary. Strict allow-list
//   projection: internal project data is never emitted.

import mongoose from 'mongoose';
import Organization from '../models/organizationModel.js';
import Project from '../models/projectModel.js';
import Unit from '../models/unitModel.js';

/**
 * Curate one project document into its public portfolio shape.
 * @param {Object} project - a Project mongoose doc (lean or hydrated)
 * @param {Array}  configSummary - [{ type, availableCount, sizeRange, priceRange }] for this project
 */
const curateProject = (project, configSummary) => {
  const p = project.portfolio || {};
  const curated = {
    id: project._id,
    name: project.name,
    type: project.type,
    status: project.status,
    location: { city: project.location?.city, area: project.location?.area },
    description: project.description || '',
    amenities: project.amenities || [],
    reraNumber: project.approvals?.rera?.number || null,
    expectedCompletionDate: project.expectedCompletionDate || null,
    totalUnits: project.totalUnits,
    coverImageUrl: p.coverImageUrl || null,
  };
  if (p.showPriceRange) {
    curated.priceRange = {
      min: project.priceRange?.min ?? null,
      max: project.priceRange?.max ?? null,
    };
  }
  if (p.showConfigurations) {
    curated.configurationSummary = configSummary || [];
  }
  return curated;
};

/**
 * Build the full curated portfolio for a developer organization.
 * Returns null if the org does not exist or is not a builder org.
 */
export const getDeveloperPortfolio = async (organizationId) => {
  const org = await Organization.findById(organizationId).select(
    'name type city contactInfo portfolioProfile'
  );
  if (!org || org.type !== 'builder') return null;

  const projects = await Project.find({
    organization: organizationId,
    'portfolio.isPublished': true,
  }).lean();

  // Live configuration summary — one aggregation across every published project
  // whose showConfigurations toggle is on.
  const configProjectIds = projects
    .filter((p) => p.portfolio?.showConfigurations)
    .map((p) => p._id);

  let configByProject = {};
  if (configProjectIds.length > 0) {
    const rows = await Unit.aggregate([
      {
        $match: {
          organization: new mongoose.Types.ObjectId(organizationId),
          project: { $in: configProjectIds },
          status: 'available',
        },
      },
      {
        $group: {
          _id: { project: '$project', type: '$type' },
          availableCount: { $sum: 1 },
          minSize: { $min: '$areaSqft' },
          maxSize: { $max: '$areaSqft' },
          minPrice: { $min: '$currentPrice' },
          maxPrice: { $max: '$currentPrice' },
        },
      },
    ]);
    configByProject = rows.reduce((acc, r) => {
      const key = String(r._id.project);
      (acc[key] = acc[key] || []).push({
        type: r._id.type,
        availableCount: r.availableCount,
        sizeRange: { min: r.minSize, max: r.maxSize },
        priceRange: { min: r.minPrice, max: r.maxPrice },
      });
      return acc;
    }, {});
  }

  return {
    profile: {
      name: org.name,
      logoUrl: org.portfolioProfile?.logoUrl || null,
      about: org.portfolioProfile?.about || '',
      city: org.city,
      contact: {
        phone: org.contactInfo?.phone || '',
        website: org.contactInfo?.website || '',
        address: org.contactInfo?.address || '',
      },
    },
    projects: projects
      .map((p) => curateProject(p, configByProject[String(p._id)]))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
};
