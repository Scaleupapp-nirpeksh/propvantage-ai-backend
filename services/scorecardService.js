// File: services/scorecardService.js
// Description: Builds the Competitive Performance Scorecard for a project —
//   five verified pillars (pricing, velocity, inventory, positioning, demand)
//   plus a competitor leaderboard, computed from the org's own data and the
//   competitors tracked in the project's locality. No AI; pure aggregation.

// ─── Math helpers ─────────────────────────────────────────────

const round = (n, dp = 2) => {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

const percentileOf = (sortedAsc, value) => {
  if (!sortedAsc.length) return null;
  const below = sortedAsc.filter((v) => v < value).length;
  return round((below / sortedAsc.length) * 100, 0);
};

const quantile = (sortedAsc, q) => {
  if (!sortedAsc.length) return null;
  const pos = (sortedAsc.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sortedAsc[base + 1] !== undefined ? sortedAsc[base + 1] : sortedAsc[base];
  return round(sortedAsc[base] + rest * (next - sortedAsc[base]));
};

const monthsBetween = (from, to) => {
  const ms = to.getTime() - from.getTime();
  return Math.max(1, ms / (1000 * 60 * 60 * 24 * 30.44));
};

// Escape regex metacharacters so localities like "St. John's" match literally.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── Core ─────────────────────────────────────────────────────

/**
 * Build the competitive performance scorecard for a project.
 * Throws Error('Project not found') if the project is missing or not in the org.
 *
 * @param {ObjectId|string} organizationId
 * @param {ObjectId|string} projectId
 * @returns {Object} the scorecard payload
 */
const buildScorecard = async (organizationId, projectId) => {
  const { default: Project } = await import('../models/projectModel.js');
  const { default: Unit } = await import('../models/unitModel.js');
  const { default: Sale } = await import('../models/salesModel.js');
  const { default: Lead } = await import('../models/leadModel.js');
  const { default: CompetitorProject } = await import('../models/competitorProjectModel.js');

  const project = await Project.findOne({ _id: projectId, organization: organizationId });
  if (!project) throw new Error('Project not found');

  const city = project.location?.city || '';
  const area = project.location?.area || '';

  const [units, sales, leads, competitors] = await Promise.all([
    Unit.find({ project: projectId, organization: organizationId }),
    Sale.find({ project: projectId, organization: organizationId }),
    Lead.find({ project: projectId, organization: organizationId }),
    CompetitorProject.find({
      organization: organizationId,
      isActive: true,
      'location.city': new RegExp(`^${escapeRe(city.trim())}$`, 'i'),
      'location.area': new RegExp(`^${escapeRe(area.trim())}$`, 'i'),
    }),
  ]);

  const now = new Date();

  // ── Pricing ──────────────────────────────────────────────
  const unitPsf = (u) =>
    u.areaSqft && u.areaSqft > 0 && u.currentPrice ? u.currentPrice / u.areaSqft : null;

  const yourPsfValues = units.map(unitPsf).filter((v) => v !== null);
  const yourAvgPsf = round(mean(yourPsfValues));

  const marketPsfValues = competitors
    .map((c) => c.pricing?.pricePerSqft?.avg)
    .filter((v) => typeof v === 'number' && v > 0)
    .sort((a, b) => a - b);

  const market = {
    min: marketPsfValues[0] ?? null,
    p25: quantile(marketPsfValues, 0.25),
    median: quantile(marketPsfValues, 0.5),
    p75: quantile(marketPsfValues, 0.75),
    max: marketPsfValues[marketPsfValues.length - 1] ?? null,
    avg: round(mean(marketPsfValues)),
  };

  // Per-unit-type pricing: your psf vs competitor unitMix psf for the same type
  const unitTypes = [...new Set(units.map((u) => u.type).filter(Boolean))];
  const byUnitType = unitTypes.map((ut) => {
    const yourTypePsf = round(
      mean(units.filter((u) => u.type === ut).map(unitPsf).filter((v) => v !== null))
    );
    const mktRanges = competitors
      .flatMap((c) => c.unitMix || [])
      .filter((m) => m.unitType === ut && m.pricePerSqftRange)
      .map((m) => m.pricePerSqftRange);
    const mins = mktRanges.map((r) => r.min).filter((v) => typeof v === 'number' && v > 0);
    const maxs = mktRanges.map((r) => r.max).filter((v) => typeof v === 'number' && v > 0);
    const midpoints = mktRanges
      .map((r) => (typeof r.min === 'number' && typeof r.max === 'number' ? (r.min + r.max) / 2 : null))
      .filter((v) => typeof v === 'number' && v > 0);
    const marketPsf = {
      min: mins.length ? Math.min(...mins) : null,
      avg: round(mean(midpoints)),
      max: maxs.length ? Math.max(...maxs) : null,
    };
    const deltaPct =
      yourTypePsf && marketPsf.avg
        ? round(((yourTypePsf - marketPsf.avg) / marketPsf.avg) * 100)
        : null;
    return { unitType: ut, yourPsf: yourTypePsf, marketPsf, deltaPct };
  });

  const pricing = {
    yourAvgPsf,
    market,
    yourPercentile:
      yourAvgPsf !== null ? percentileOf(marketPsfValues, yourAvgPsf) : null,
    premiumDiscountPct:
      yourAvgPsf !== null && market.avg
        ? round(((yourAvgPsf - market.avg) / market.avg) * 100)
        : null,
    byUnitType,
    competitorCount: competitors.length,
  };

  // ── Velocity ─────────────────────────────────────────────
  const totalUnits = units.length;
  const soldUnits = units.filter((u) => ['sold', 'booked'].includes(u.status)).length;
  const availableUnits = units.filter((u) => u.status === 'available').length;
  // 'blocked' units are neither sold nor on the market — surfaced separately
  // so percentSold / inventory math don't silently hide them.
  const blockedUnits = units.filter((u) => u.status === 'blocked').length;

  const liveSales = sales.filter((s) => s.status !== 'Cancelled');
  const revenueAchieved = round(
    liveSales.reduce((sum, s) => sum + (s.salePrice || 0), 0),
    0
  );
  const saleDates = liveSales
    .map((s) => s.bookingDate || s.createdAt)
    .filter(Boolean)
    .map((d) => new Date(d));
  const earliestSale = saleDates.length
    ? new Date(Math.min(...saleDates.map((d) => d.getTime())))
    : null;
  const monthsActive = earliestSale ? round(monthsBetween(earliestSale, now), 1) : null;
  const unitsPerMonth =
    monthsActive && liveSales.length ? round(liveSales.length / monthsActive, 2) : null;

  let projectedSelloutDate = null;
  if (unitsPerMonth && unitsPerMonth > 0 && availableUnits > 0) {
    const d = new Date(now);
    d.setMonth(d.getMonth() + Math.ceil(availableUnits / unitsPerMonth));
    projectedSelloutDate = d.toISOString().slice(0, 10);
  }

  const velocity = {
    totalUnits,
    soldUnits,
    availableUnits,
    blockedUnits,
    percentSold: totalUnits ? round((soldUnits / totalUnits) * 100, 1) : null,
    monthsActive,
    unitsPerMonth,
    revenueAchieved,
    targetRevenue: project.targetRevenue || null,
    revenuePercent: project.targetRevenue
      ? round((revenueAchieved / project.targetRevenue) * 100, 1)
      : null,
    projectedSelloutDate,
  };

  // ── Inventory ────────────────────────────────────────────
  const unsoldByType = {};
  units
    .filter((u) => u.status === 'available')
    .forEach((u) => {
      const t = u.type || 'Unspecified';
      unsoldByType[t] = (unsoldByType[t] || 0) + 1;
    });

  const competingByType = {};
  competitors
    .flatMap((c) => c.unitMix || [])
    .forEach((m) => {
      const t = m.unitType || 'Unspecified';
      if (!competingByType[t]) competingByType[t] = { totalCount: 0, availableCount: 0 };
      competingByType[t].totalCount += m.totalCount || 0;
      competingByType[t].availableCount += m.availableCount || 0;
    });

  const inventory = {
    yourUnsoldByType: Object.entries(unsoldByType).map(([unitType, count]) => ({
      unitType,
      count,
    })),
    competingSupplyByType: Object.entries(competingByType).map(([unitType, v]) => ({
      unitType,
      totalCount: v.totalCount,
      availableCount: v.availableCount,
    })),
    monthsOfInventory:
      unitsPerMonth && unitsPerMonth > 0 ? round(availableUnits / unitsPerMonth, 1) : null,
  };

  // ── Positioning ──────────────────────────────────────────
  const positioning = {
    your: { status: project.status || null, totalUnits: project.totalUnits || null },
    competitors: competitors.map((c) => ({
      name: c.projectName,
      projectStatus: c.projectStatus || null,
      possession:
        c.possessionTimeline?.description ||
        (c.possessionTimeline?.expectedDate
          ? new Date(c.possessionTimeline.expectedDate).toISOString().slice(0, 10)
          : null),
      totalUnits: c.totalUnits || null,
    })),
  };

  // ── Demand (own leads) ───────────────────────────────────
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const trendMonths = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trendMonths.push({ key: d.toISOString().slice(0, 7), count: 0 });
  }
  leads.forEach((l) => {
    const key = new Date(l.createdAt).toISOString().slice(0, 7);
    const bucket = trendMonths.find((m) => m.key === key);
    if (bucket) bucket.count += 1;
  });
  const qualityMix = {};
  leads.forEach((l) => {
    const g = l.scoreGrade || 'D';
    qualityMix[g] = (qualityMix[g] || 0) + 1;
  });

  const demand = {
    yourLeads: {
      total: leads.length,
      last30d: leads.filter((l) => new Date(l.createdAt) >= thirtyDaysAgo).length,
      trend: trendMonths.map((m) => ({ month: m.key, count: m.count })),
      qualityMix: Object.entries(qualityMix).map(([grade, count]) => ({ grade, count })),
    },
  };

  // ── Leaderboard ──────────────────────────────────────────
  const leaderboard = competitors
    .map((c) => {
      const avgPsf = c.pricing?.pricePerSqft?.avg || null;
      const deltaPsfPct =
        avgPsf && yourAvgPsf ? round(((avgPsf - yourAvgPsf) / yourAvgPsf) * 100) : null;
      return {
        competitorId: c._id,
        name: c.projectName,
        developer: c.developerName,
        avgPsf,
        deltaPsfPct,
        projectStatus: c.projectStatus || null,
        _distance: avgPsf && yourAvgPsf ? Math.abs(avgPsf - yourAvgPsf) : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a._distance - b._distance)
    .map((row, i) => {
      const { _distance, ...rest } = row;
      return { ...rest, threatRank: i + 1 };
    });

  return {
    project: {
      id: project._id,
      name: project.name,
      city,
      area,
      status: project.status || null,
      totalUnits: project.totalUnits || null,
      targetRevenue: project.targetRevenue || null,
    },
    pricing,
    velocity,
    inventory,
    positioning,
    demand,
    leaderboard,
    meta: {
      hasCompetitorData: competitors.length > 0,
      locality: [area, city].filter(Boolean).join(', '),
      generatedAt: now.toISOString(),
    },
  };
};

export { buildScorecard };
