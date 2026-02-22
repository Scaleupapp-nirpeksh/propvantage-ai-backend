// File: services/competitiveDataService.js
// Description: Core data operations for competitive analysis — aggregation,
// IQR-based outlier detection, market snapshot generation, and data hashing.

import crypto from 'crypto';
import CompetitorProject from '../models/competitorProjectModel.js';
import MarketDataSnapshot from '../models/marketDataSnapshotModel.js';

// ─── Statistical Helpers ─────────────────────────────────────

/**
 * Compute percentile from a sorted array.
 */
const percentile = (sortedArr, p) => {
  if (sortedArr.length === 0) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sortedArr[lower];
  return sortedArr[lower] + (sortedArr[upper] - sortedArr[lower]) * (idx - lower);
};

/**
 * Compute median from a sorted array.
 */
const median = (sortedArr) => percentile(sortedArr, 50);

/**
 * Compute standard deviation.
 */
const stdDev = (values, avg) => {
  if (values.length < 2) return 0;
  const sqDiffs = values.map((v) => Math.pow(v - avg, 2));
  return Math.sqrt(sqDiffs.reduce((a, b) => a + b, 0) / (values.length - 1));
};

/**
 * IQR-based outlier detection.
 * Returns values with outliers removed (only applied when n >= 5).
 */
const removeOutliers = (values) => {
  if (values.length < 5) return { cleaned: values, outliersRemoved: 0 };

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  const cleaned = sorted.filter((v) => v >= lowerBound && v <= upperBound);
  return {
    cleaned,
    outliersRemoved: values.length - cleaned.length,
    bounds: { lower: lowerBound, upper: upperBound },
  };
};

// ─── Data Hashing ────────────────────────────────────────────

/**
 * Generate MD5 hash of competitor data for cache invalidation.
 */
const computeDataHash = (competitors) => {
  const summary = competitors.map((c) => ({
    id: c._id?.toString(),
    name: c.projectName,
    priceAvg: c.pricing?.pricePerSqft?.avg,
    updatedAt: c.updatedAt?.toISOString(),
  }));
  return crypto.createHash('md5').update(JSON.stringify(summary)).digest('hex');
};

// ─── Market Overview ─────────────────────────────────────────

/**
 * Generate aggregated market stats for a locality.
 * Used for real-time market overview (not persisted as snapshot).
 */
const getMarketOverview = async (organizationId, city, area) => {
  const competitors = await CompetitorProject.find({
    organization: organizationId,
    'location.city': new RegExp(`^${city.trim()}$`, 'i'),
    'location.area': new RegExp(`^${area.trim()}$`, 'i'),
    isActive: true,
  }).lean();

  if (competitors.length === 0) {
    return { totalProjects: 0, message: 'No competitor data for this locality' };
  }

  // Price per sqft analysis (with outlier removal)
  const priceValues = competitors
    .map((c) => c.pricing?.pricePerSqft?.avg)
    .filter((v) => v && v > 0);

  const { cleaned: cleanedPrices, outliersRemoved } = removeOutliers(priceValues);
  const sortedPrices = [...cleanedPrices].sort((a, b) => a - b);

  const avgPrice = sortedPrices.length > 0
    ? Math.round(sortedPrices.reduce((a, b) => a + b, 0) / sortedPrices.length)
    : 0;

  // Floor rise charge analysis
  const floorRiseValues = competitors
    .map((c) => c.pricing?.floorRiseCharge)
    .filter((v) => v && v > 0);
  const sortedFloorRise = [...floorRiseValues].sort((a, b) => a - b);

  // Unit type distribution
  const unitTypeCounts = {};
  for (const c of competitors) {
    if (c.unitMix) {
      for (const u of c.unitMix) {
        const type = u.unitType || 'Unknown';
        unitTypeCounts[type] = (unitTypeCounts[type] || 0) + (u.totalCount || 1);
      }
    }
  }
  const totalUnitCount = Object.values(unitTypeCounts).reduce((a, b) => a + b, 0);

  // Project status distribution
  const statusCounts = {};
  for (const c of competitors) {
    statusCounts[c.projectStatus] = (statusCounts[c.projectStatus] || 0) + 1;
  }

  // Amenity prevalence
  const amenityNames = [
    'gym', 'swimmingPool', 'clubhouse', 'garden', 'playground',
    'powerBackup', 'security24x7', 'lifts', 'joggingTrack',
    'indoorGames', 'multipurposeHall', 'rainwaterHarvesting',
    'solarPanels', 'evCharging', 'concierge', 'coWorkingSpace',
  ];
  const amenityCounts = {};
  for (const c of competitors) {
    if (c.amenities) {
      for (const name of amenityNames) {
        if (c.amenities[name]) {
          amenityCounts[name] = (amenityCounts[name] || 0) + 1;
        }
      }
    }
  }

  // Total units in market
  const totalUnitsInMarket = competitors.reduce(
    (sum, c) => sum + (c.totalUnits || 0), 0
  );

  // Data quality
  const now = Date.now();
  let staleCount = 0;
  let verifiedCount = 0;
  const confidenceScores = [];
  for (const c of competitors) {
    const ageDays = (now - new Date(c.dataCollectionDate).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > 90) staleCount++;
    if (c.lastVerifiedAt) verifiedCount++;
    confidenceScores.push(c.confidenceScore || 50);
  }

  return {
    totalProjects: competitors.length,
    totalUnitsInMarket,
    pricePerSqft: {
      min: sortedPrices.length > 0 ? sortedPrices[0] : 0,
      max: sortedPrices.length > 0 ? sortedPrices[sortedPrices.length - 1] : 0,
      avg: avgPrice,
      median: Math.round(median(sortedPrices)),
      p25: Math.round(percentile(sortedPrices, 25)),
      p75: Math.round(percentile(sortedPrices, 75)),
      stdDev: Math.round(stdDev(sortedPrices, avgPrice)),
      outliersRemoved,
    },
    floorRiseCharge: {
      min: sortedFloorRise.length > 0 ? sortedFloorRise[0] : 0,
      max: sortedFloorRise.length > 0 ? sortedFloorRise[sortedFloorRise.length - 1] : 0,
      avg: sortedFloorRise.length > 0
        ? Math.round(sortedFloorRise.reduce((a, b) => a + b, 0) / sortedFloorRise.length)
        : 0,
    },
    unitTypeDistribution: Object.entries(unitTypeCounts)
      .map(([type, count]) => ({
        unitType: type,
        count,
        percentage: totalUnitCount > 0 ? Math.round((count / totalUnitCount) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count),
    projectStatusDistribution: Object.entries(statusCounts)
      .map(([status, count]) => ({
        status,
        count,
        percentage: Math.round((count / competitors.length) * 100),
      }))
      .sort((a, b) => b.count - a.count),
    amenityPrevalence: Object.entries(amenityCounts)
      .map(([amenity, count]) => ({
        amenity,
        count,
        percentage: Math.round((count / competitors.length) * 100),
      }))
      .sort((a, b) => b.count - a.count),
    dataQuality: {
      totalDataPoints: competitors.length,
      verifiedDataPoints: verifiedCount,
      averageConfidenceScore: Math.round(
        confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
      ),
      staleDataPoints: staleCount,
    },
    dataHash: computeDataHash(competitors),
  };
};

// ─── Snapshot Generation ─────────────────────────────────────

/**
 * Generate and persist a market data snapshot for a locality.
 * Compares with the previous snapshot to calculate trends.
 */
const generateSnapshot = async (organizationId, city, area, generatedBy = 'on_demand') => {
  const overview = await getMarketOverview(organizationId, city, area);

  if (overview.totalProjects === 0) {
    return null;
  }

  // Get competitor IDs for provenance
  const competitorIds = await CompetitorProject.find({
    organization: organizationId,
    'location.city': new RegExp(`^${city.trim()}$`, 'i'),
    'location.area': new RegExp(`^${area.trim()}$`, 'i'),
    isActive: true,
  })
    .select('_id')
    .lean();

  // Get previous snapshot for trend calculation
  const previousSnapshot = await MarketDataSnapshot.findOne({
    organization: organizationId,
    'snapshotScope.city': new RegExp(`^${city.trim()}$`, 'i'),
    'snapshotScope.area': new RegExp(`^${area.trim()}$`, 'i'),
  })
    .sort({ snapshotDate: -1 })
    .lean();

  // Calculate trends
  const trends = {
    pricePerSqftChange: 0,
    pricePerSqftChangeAbsolute: 0,
    newProjectsAdded: 0,
    projectsCompleted: 0,
    supplyChange: 0,
  };

  if (previousSnapshot) {
    const prevAvg = previousSnapshot.marketMetrics?.pricePerSqft?.avg || 0;
    const currAvg = overview.pricePerSqft?.avg || 0;

    if (prevAvg > 0) {
      trends.pricePerSqftChange = Math.round(((currAvg - prevAvg) / prevAvg) * 10000) / 100;
      trends.pricePerSqftChangeAbsolute = currAvg - prevAvg;
    }

    const prevTotal = previousSnapshot.marketMetrics?.totalActiveProjects || 0;
    trends.newProjectsAdded = Math.max(0, overview.totalProjects - prevTotal);

    const prevUnits = previousSnapshot.marketMetrics?.totalUnitsInMarket || 0;
    if (prevUnits > 0) {
      trends.supplyChange =
        Math.round(((overview.totalUnitsInMarket - prevUnits) / prevUnits) * 10000) / 100;
    }
  }

  // Upsert snapshot (one per day per locality)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const snapshot = await MarketDataSnapshot.findOneAndUpdate(
    {
      organization: organizationId,
      'snapshotScope.city': city.trim(),
      'snapshotScope.area': area.trim(),
      snapshotDate: today,
    },
    {
      $set: {
        snapshotScope: { city: city.trim(), area: area.trim() },
        snapshotDate: today,
        marketMetrics: {
          totalActiveProjects: overview.totalProjects,
          totalUnitsInMarket: overview.totalUnitsInMarket,
          pricePerSqft: overview.pricePerSqft,
          floorRiseCharge: overview.floorRiseCharge,
          unitTypeDistribution: overview.unitTypeDistribution,
          projectStatusDistribution: overview.projectStatusDistribution,
          amenityPrevalence: overview.amenityPrevalence,
        },
        trends,
        dataQuality: overview.dataQuality,
        sourceCompetitorIds: competitorIds.map((c) => c._id),
        generatedBy,
      },
      $setOnInsert: {
        organization: organizationId,
      },
    },
    { upsert: true, new: true }
  );

  return snapshot;
};

// ─── Market Trends ───────────────────────────────────────────

/**
 * Get historical trend data from snapshots.
 */
const getMarketTrends = async (organizationId, city, area, months = 6) => {
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - months);

  const snapshots = await MarketDataSnapshot.find({
    organization: organizationId,
    'snapshotScope.city': new RegExp(`^${city.trim()}$`, 'i'),
    'snapshotScope.area': new RegExp(`^${area.trim()}$`, 'i'),
    snapshotDate: { $gte: cutoffDate },
  })
    .sort({ snapshotDate: 1 })
    .lean();

  if (snapshots.length === 0) {
    return {
      dataPoints: 0,
      message: 'No historical snapshots. Market trends will build over time as snapshots are generated.',
    };
  }

  return {
    dataPoints: snapshots.length,
    period: {
      from: snapshots[0].snapshotDate,
      to: snapshots[snapshots.length - 1].snapshotDate,
    },
    priceHistory: snapshots.map((s) => ({
      date: s.snapshotDate,
      avg: s.marketMetrics?.pricePerSqft?.avg || 0,
      min: s.marketMetrics?.pricePerSqft?.min || 0,
      max: s.marketMetrics?.pricePerSqft?.max || 0,
      median: s.marketMetrics?.pricePerSqft?.median || 0,
    })),
    supplyHistory: snapshots.map((s) => ({
      date: s.snapshotDate,
      totalProjects: s.marketMetrics?.totalActiveProjects || 0,
      totalUnits: s.marketMetrics?.totalUnitsInMarket || 0,
    })),
    latestTrends: snapshots[snapshots.length - 1]?.trends || {},
  };
};

// ─── Demand-Supply Analysis ──────────────────────────────────

/**
 * Analyze demand-supply gap based on unit type distribution and project statuses.
 */
const getDemandSupplyAnalysis = async (organizationId, city, area) => {
  const competitors = await CompetitorProject.find({
    organization: organizationId,
    'location.city': new RegExp(`^${city.trim()}$`, 'i'),
    'location.area': new RegExp(`^${area.trim()}$`, 'i'),
    isActive: true,
  }).lean();

  if (competitors.length === 0) {
    return { totalProjects: 0, message: 'No competitor data available' };
  }

  // Supply by unit type
  const supplyByType = {};
  const priceByType = {};
  for (const c of competitors) {
    if (c.unitMix) {
      for (const u of c.unitMix) {
        const type = u.unitType || 'Unknown';
        if (!supplyByType[type]) {
          supplyByType[type] = { total: 0, available: 0, projects: 0 };
          priceByType[type] = [];
        }
        supplyByType[type].total += u.totalCount || 0;
        supplyByType[type].available += u.availableCount || 0;
        supplyByType[type].projects += 1;
        if (u.pricePerSqftRange?.min) priceByType[type].push(u.pricePerSqftRange.min);
        if (u.pricePerSqftRange?.max) priceByType[type].push(u.pricePerSqftRange.max);
      }
    }
  }

  // Supply by status (pipeline indicator)
  const pipeline = {
    pre_launch: 0,
    newly_launched: 0,
    under_construction: 0,
    ready_to_move: 0,
    completed: 0,
  };
  for (const c of competitors) {
    if (pipeline[c.projectStatus] !== undefined) {
      pipeline[c.projectStatus] += c.totalUnits || 0;
    }
  }

  const totalSupply = Object.values(pipeline).reduce((a, b) => a + b, 0);
  const upcomingSupply = pipeline.pre_launch + pipeline.newly_launched;
  const activeSupply = pipeline.under_construction + pipeline.ready_to_move;

  return {
    totalProjects: competitors.length,
    totalSupply,
    supplyByUnitType: Object.entries(supplyByType).map(([type, data]) => ({
      unitType: type,
      totalUnits: data.total,
      availableUnits: data.available,
      projectCount: data.projects,
      avgPricePerSqft: priceByType[type].length > 0
        ? Math.round(priceByType[type].reduce((a, b) => a + b, 0) / priceByType[type].length)
        : null,
    })),
    supplyPipeline: {
      upcoming: upcomingSupply,
      active: activeSupply,
      completed: pipeline.completed,
      breakdown: pipeline,
    },
    marketSaturation: {
      projectDensity: competitors.length,
      supplyConcentration: totalSupply > 0
        ? Object.entries(supplyByType)
            .map(([type, data]) => ({
              type,
              share: Math.round((data.total / totalSupply) * 100),
            }))
            .sort((a, b) => b.share - a.share)
        : [],
    },
  };
};

export {
  removeOutliers,
  computeDataHash,
  getMarketOverview,
  generateSnapshot,
  getMarketTrends,
  getDemandSupplyAnalysis,
};
