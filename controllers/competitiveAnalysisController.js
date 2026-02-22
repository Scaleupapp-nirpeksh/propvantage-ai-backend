// File: controllers/competitiveAnalysisController.js
// Description: API handlers for the Competitive Analysis & AI Recommendation Engine.

import asyncHandler from 'express-async-handler';
import CompetitorProject from '../models/competitorProjectModel.js';
import DataProviderConfig from '../models/dataProviderConfigModel.js';
import { executeResearch } from '../services/aiResearchService.js';
import { importCSV, exportCSV, generateCSVTemplate } from '../services/csvImportService.js';
import {
  getMarketOverview as fetchMarketOverview,
  generateSnapshot,
  getMarketTrends as fetchMarketTrends,
  getDemandSupplyAnalysis as fetchDemandSupply,
} from '../services/competitiveDataService.js';
import { generateAnalysis } from '../services/competitiveAIService.js';

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Compute data freshness summary for a set of competitor records.
 */
const computeDataFreshness = (competitors) => {
  if (!competitors || competitors.length === 0) {
    return {
      freshCount: 0,
      recentCount: 0,
      staleCount: 0,
      oldestDataDate: null,
      newestDataDate: null,
      overallFreshnessScore: 0,
      recommendation: 'No competitive data available. Start by adding competitors or running AI Research.',
    };
  }

  const now = Date.now();
  let fresh = 0;
  let recent = 0;
  let stale = 0;
  let oldest = Infinity;
  let newest = 0;

  for (const c of competitors) {
    const ts = c.dataCollectionDate?.getTime() || 0;
    const ageDays = (now - ts) / (1000 * 60 * 60 * 24);

    if (ageDays < 30) fresh++;
    else if (ageDays < 90) recent++;
    else stale++;

    if (ts < oldest) oldest = ts;
    if (ts > newest) newest = ts;
  }

  const total = competitors.length;
  const score = Math.round(((fresh * 100 + recent * 50 + stale * 10) / total));

  let recommendation = null;
  if (stale > 0) {
    recommendation = `${stale} competitor record${stale > 1 ? 's are' : ' is'} stale (>90 days old). Consider running AI Research to refresh.`;
  } else if (recent > total / 2) {
    recommendation = 'Most data is 30-90 days old. Consider refreshing soon.';
  }

  return {
    freshCount: fresh,
    recentCount: recent,
    staleCount: stale,
    oldestDataDate: oldest === Infinity ? null : new Date(oldest),
    newestDataDate: newest === 0 ? null : new Date(newest),
    overallFreshnessScore: Math.min(score, 100),
    recommendation,
  };
};

// ─── CRUD: Competitor Projects ────────────────────────────────

/**
 * @desc    Create a competitor project
 * @route   POST /api/competitive-analysis/competitors
 * @access  Private (competitive_analysis:manage_data)
 */
const createCompetitorProject = asyncHandler(async (req, res) => {
  const data = {
    ...req.body,
    organization: req.user.organization,
    createdBy: req.user._id,
  };

  // Check for duplicates
  const existing = await CompetitorProject.findDuplicates(
    req.user.organization,
    data.projectName,
    data.location?.area
  );
  if (existing.length > 0) {
    res.status(409);
    throw new Error(
      `A competitor project named "${data.projectName}" already exists in "${data.location?.area}". Use PUT to update it.`
    );
  }

  const competitor = await CompetitorProject.create(data);

  res.status(201).json({
    success: true,
    data: competitor,
    message: 'Competitor project created successfully',
  });
});

/**
 * @desc    Get all competitor projects (with filters)
 * @route   GET /api/competitive-analysis/competitors
 * @access  Private (competitive_analysis:view)
 */
const getCompetitorProjects = asyncHandler(async (req, res) => {
  const {
    city,
    area,
    projectType,
    projectStatus,
    dataSource,
    isActive = 'true',
    page = 1,
    limit = 20,
    sortBy = 'dataCollectionDate',
    sortOrder = 'desc',
  } = req.query;

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const filter = { organization: req.user.organization };
  if (city) filter['location.city'] = new RegExp(city, 'i');
  if (area) filter['location.area'] = new RegExp(area, 'i');
  if (projectType) filter.projectType = projectType;
  if (projectStatus) filter.projectStatus = projectStatus;
  if (dataSource) filter.dataSource = dataSource;
  if (isActive !== undefined) filter.isActive = isActive === 'true';

  const sortObj = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [competitors, total] = await Promise.all([
    CompetitorProject.find(filter)
      .populate('createdBy', 'firstName lastName')
      .populate('updatedBy', 'firstName lastName')
      .populate('lastVerifiedBy', 'firstName lastName')
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit))
      .lean({ virtuals: true }),
    CompetitorProject.countDocuments(filter),
  ]);

  const dataFreshness = computeDataFreshness(competitors);

  res.json({
    success: true,
    data: competitors,
    dataFreshness,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
    },
  });
});

/**
 * @desc    Get single competitor project
 * @route   GET /api/competitive-analysis/competitors/:id
 * @access  Private (competitive_analysis:view)
 */
const getCompetitorProjectById = asyncHandler(async (req, res) => {
  const competitor = await CompetitorProject.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  })
    .populate('createdBy', 'firstName lastName')
    .populate('updatedBy', 'firstName lastName')
    .populate('lastVerifiedBy', 'firstName lastName');

  if (!competitor) {
    res.status(404);
    throw new Error('Competitor project not found');
  }

  res.json({ success: true, data: competitor });
});

/**
 * @desc    Update competitor project
 * @route   PUT /api/competitive-analysis/competitors/:id
 * @access  Private (competitive_analysis:manage_data)
 */
const updateCompetitorProject = asyncHandler(async (req, res) => {
  const competitor = await CompetitorProject.findOne({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!competitor) {
    res.status(404);
    throw new Error('Competitor project not found');
  }

  // Do not allow changing organization
  delete req.body.organization;
  delete req.body.createdBy;

  Object.assign(competitor, req.body);
  competitor.updatedBy = req.user._id;
  await competitor.save();

  res.json({
    success: true,
    data: competitor,
    message: 'Competitor project updated successfully',
  });
});

/**
 * @desc    Delete competitor project
 * @route   DELETE /api/competitive-analysis/competitors/:id
 * @access  Private (competitive_analysis:manage_data)
 */
const deleteCompetitorProject = asyncHandler(async (req, res) => {
  const competitor = await CompetitorProject.findOneAndDelete({
    _id: req.params.id,
    organization: req.user.organization,
  });

  if (!competitor) {
    res.status(404);
    throw new Error('Competitor project not found');
  }

  res.json({
    success: true,
    message: 'Competitor project deleted successfully',
  });
});

// ─── Dashboard ────────────────────────────────────────────────

/**
 * @desc    Get competitive analysis dashboard summary
 * @route   GET /api/competitive-analysis/dashboard
 * @access  Private (competitive_analysis:view)
 */
const getDashboardSummary = asyncHandler(async (req, res) => {
  const orgId = req.user.organization;

  // Aggregate stats
  const [
    totalCompetitors,
    activeCompetitors,
    localityStats,
    sourceDistribution,
    recentlyAdded,
  ] = await Promise.all([
    CompetitorProject.countDocuments({ organization: orgId }),
    CompetitorProject.countDocuments({ organization: orgId, isActive: true }),
    CompetitorProject.aggregate([
      { $match: { organization: orgId, isActive: true } },
      {
        $group: {
          _id: { city: '$location.city', area: '$location.area' },
          count: { $sum: 1 },
          avgConfidence: { $avg: '$confidenceScore' },
          avgPricePerSqft: { $avg: '$pricing.pricePerSqft.avg' },
          latestData: { $max: '$dataCollectionDate' },
        },
      },
      { $sort: { count: -1 } },
    ]),
    CompetitorProject.aggregate([
      { $match: { organization: orgId, isActive: true } },
      { $group: { _id: '$dataSource', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    CompetitorProject.find({ organization: orgId, isActive: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('projectName developerName location.city location.area pricing.pricePerSqft.avg dataSource dataCollectionDate confidenceScore')
      .lean({ virtuals: true }),
  ]);

  // Compute overall freshness
  const allCompetitors = await CompetitorProject.find({
    organization: orgId,
    isActive: true,
  }).select('dataCollectionDate').lean();
  const dataFreshness = computeDataFreshness(allCompetitors);

  res.json({
    success: true,
    data: {
      totalCompetitors,
      activeCompetitors,
      localitiesTracked: localityStats.length,
      localities: localityStats.map((l) => ({
        city: l._id.city,
        area: l._id.area,
        competitorCount: l.count,
        avgConfidenceScore: Math.round(l.avgConfidence),
        avgPricePerSqft: Math.round(l.avgPricePerSqft || 0),
        latestDataDate: l.latestData,
      })),
      sourceDistribution: sourceDistribution.map((s) => ({
        source: s._id,
        count: s.count,
      })),
      recentlyAdded,
      dataFreshness,
    },
  });
});

// ─── Provider Management ──────────────────────────────────────

/**
 * @desc    Get all provider configs for this org
 * @route   GET /api/competitive-analysis/providers
 * @access  Private (competitive_analysis:manage_providers)
 */
const getProviderConfigs = asyncHandler(async (req, res) => {
  const configs = await DataProviderConfig.find({
    organization: req.user.organization,
  }).sort({ providerName: 1 });

  res.json({ success: true, data: configs });
});

/**
 * @desc    Update provider config
 * @route   PUT /api/competitive-analysis/providers/:providerName
 * @access  Private (competitive_analysis:manage_providers)
 */
const updateProviderConfig = asyncHandler(async (req, res) => {
  const config = await DataProviderConfig.findOneAndUpdate(
    {
      organization: req.user.organization,
      providerName: req.params.providerName,
    },
    {
      $set: {
        ...req.body,
        configuredBy: req.user._id,
      },
      $setOnInsert: {
        organization: req.user.organization,
        providerName: req.params.providerName,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );

  res.json({
    success: true,
    data: config,
    message: `Provider "${req.params.providerName}" configuration updated`,
  });
});

/**
 * @desc    Trigger provider sync
 * @route   POST /api/competitive-analysis/providers/:providerName/sync
 * @access  Private (competitive_analysis:manage_providers)
 */
const triggerProviderSync = asyncHandler(async (req, res) => {
  // Placeholder for future API provider sync
  res.status(501).json({
    success: false,
    message: `Sync for provider "${req.params.providerName}" is not yet implemented. Use manual entry, CSV import, or AI Research.`,
  });
});

// ─── AI Web Research ──────────────────────────────────────────

/**
 * @desc    Trigger AI web research for a locality
 * @route   POST /api/competitive-analysis/research
 * @access  Private (competitive_analysis:ai_research)
 */
const triggerAIResearch = asyncHandler(async (req, res) => {
  const { city, area, projectType, additionalContext } = req.body;

  if (!city || !area) {
    res.status(400);
    throw new Error('Both "city" and "area" are required for AI research');
  }

  const result = await executeResearch({
    organizationId: req.user.organization,
    city: city.trim(),
    area: area.trim(),
    projectType,
    additionalContext,
    userId: req.user._id,
  });

  res.json({
    success: true,
    data: result,
    message: result.researchSummary,
  });
});

// ─── CSV Import / Export ──────────────────────────────────────

/**
 * @desc    Import competitor data from CSV file
 * @route   POST /api/competitive-analysis/import-csv
 * @access  Private (competitive_analysis:manage_data)
 */
const importCompetitorCSV = asyncHandler(async (req, res) => {
  if (!req.file) {
    res.status(400);
    throw new Error('No CSV file uploaded. Send a CSV file via multipart/form-data with field name "file".');
  }

  const { city, area } = req.body;
  // Custom column mapping can be sent as JSON string
  let customColumnMap;
  if (req.body.columnMapping) {
    try {
      customColumnMap = JSON.parse(req.body.columnMapping);
    } catch {
      res.status(400);
      throw new Error('"columnMapping" must be valid JSON');
    }
  }

  const result = await importCSV({
    csvData: req.file.buffer,
    organizationId: req.user.organization,
    userId: req.user._id,
    city: city?.trim(),
    area: area?.trim(),
    customColumnMap,
  });

  res.json({
    success: true,
    data: result,
    message: result.summary,
  });
});

/**
 * @desc    Export competitor data as CSV
 * @route   GET /api/competitive-analysis/export-csv
 * @access  Private (competitive_analysis:manage_data)
 */
const exportCompetitorCSV = asyncHandler(async (req, res) => {
  const { city, area, projectType, projectStatus } = req.query;

  const filter = { organization: req.user.organization, isActive: true };
  if (city) filter['location.city'] = new RegExp(city, 'i');
  if (area) filter['location.area'] = new RegExp(area, 'i');
  if (projectType) filter.projectType = projectType;
  if (projectStatus) filter.projectStatus = projectStatus;

  const competitors = await CompetitorProject.find(filter)
    .sort({ 'location.city': 1, 'location.area': 1, projectName: 1 })
    .lean();

  if (competitors.length === 0) {
    res.status(404);
    throw new Error('No competitor data found for the given filters');
  }

  const csv = exportCSV(competitors);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="competitor_data.csv"');
  res.send(csv);
});

/**
 * @desc    Download blank CSV template for competitor data import
 * @route   GET /api/competitive-analysis/csv-template
 * @access  Private (competitive_analysis:view)
 */
const downloadCSVTemplate = asyncHandler(async (req, res) => {
  const csv = generateCSVTemplate();

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="competitor_import_template.csv"');
  res.send(csv);
});

// ─── Market Intelligence ─────────────────────────────────────

/**
 * @desc    Get aggregated market overview for a locality
 * @route   GET /api/competitive-analysis/market-overview
 * @access  Private (competitive_analysis:view)
 */
const getMarketOverview = asyncHandler(async (req, res) => {
  const { city, area } = req.query;

  if (!city || !area) {
    res.status(400);
    throw new Error('Both "city" and "area" query parameters are required');
  }

  const overview = await fetchMarketOverview(req.user.organization, city, area);

  // Also generate/refresh today's snapshot
  if (overview.totalProjects > 0) {
    await generateSnapshot(req.user.organization, city, area, 'on_demand');
  }

  res.json({ success: true, data: overview });
});

/**
 * @desc    Get historical market trends for a locality
 * @route   GET /api/competitive-analysis/market-trends
 * @access  Private (competitive_analysis:view)
 */
const getMarketTrends = asyncHandler(async (req, res) => {
  const { city, area, months = 6 } = req.query;

  if (!city || !area) {
    res.status(400);
    throw new Error('Both "city" and "area" query parameters are required');
  }

  const trends = await fetchMarketTrends(
    req.user.organization,
    city,
    area,
    parseInt(months)
  );

  res.json({ success: true, data: trends });
});

/**
 * @desc    Get demand-supply gap analysis for a locality
 * @route   GET /api/competitive-analysis/demand-supply
 * @access  Private (competitive_analysis:view)
 */
const getDemandSupply = asyncHandler(async (req, res) => {
  const { city, area } = req.query;

  if (!city || !area) {
    res.status(400);
    throw new Error('Both "city" and "area" query parameters are required');
  }

  const analysis = await fetchDemandSupply(req.user.organization, city, area);

  res.json({ success: true, data: analysis });
});

// ─── AI Analysis & Recommendations ───────────────────────────

const VALID_ANALYSIS_TYPES = [
  'pricing_recommendations', 'revenue_planning', 'absorption_rate',
  'demand_supply_gap', 'launch_timing', 'optimal_unit_mix',
  'marketing_strategy', 'comprehensive',
];

/**
 * @desc    Get or generate AI competitive analysis for a project
 * @route   GET /api/competitive-analysis/analysis/:projectId
 * @access  Private (competitive_analysis:ai_recommendations)
 */
const getAnalysis = asyncHandler(async (req, res) => {
  const { type = 'comprehensive' } = req.query;

  if (!VALID_ANALYSIS_TYPES.includes(type)) {
    res.status(400);
    throw new Error(
      `Invalid analysis type "${type}". Must be one of: ${VALID_ANALYSIS_TYPES.join(', ')}`
    );
  }

  const result = await generateAnalysis({
    organizationId: req.user.organization,
    projectId: req.params.projectId,
    analysisType: type,
    userId: req.user._id,
  });

  res.json({
    success: true,
    data: result,
    message: result.fromCache
      ? 'Returning cached analysis (data unchanged since last generation)'
      : `${type} analysis generated successfully`,
  });
});

/**
 * @desc    Force re-generate AI analysis (bypass cache)
 * @route   POST /api/competitive-analysis/analysis/:projectId/refresh
 * @access  Private (competitive_analysis:ai_recommendations)
 */
const refreshAnalysis = asyncHandler(async (req, res) => {
  const { type = 'comprehensive' } = req.body;

  if (!VALID_ANALYSIS_TYPES.includes(type)) {
    res.status(400);
    throw new Error(
      `Invalid analysis type "${type}". Must be one of: ${VALID_ANALYSIS_TYPES.join(', ')}`
    );
  }

  const result = await generateAnalysis({
    organizationId: req.user.organization,
    projectId: req.params.projectId,
    analysisType: type,
    userId: req.user._id,
    forceRefresh: true,
  });

  res.json({
    success: true,
    data: result,
    message: `${type} analysis refreshed successfully`,
  });
});

export {
  createCompetitorProject,
  getCompetitorProjects,
  getCompetitorProjectById,
  updateCompetitorProject,
  deleteCompetitorProject,
  getDashboardSummary,
  getProviderConfigs,
  updateProviderConfig,
  triggerProviderSync,
  triggerAIResearch,
  importCompetitorCSV,
  exportCompetitorCSV,
  downloadCSVTemplate,
  getMarketOverview,
  getMarketTrends,
  getDemandSupply,
  getAnalysis,
  refreshAnalysis,
};
