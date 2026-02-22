// File: services/competitiveAIService.js
// Description: AI Recommendation Engine for competitive analysis.
// Uses Anthropic Claude for superior analytical reasoning on 7 analysis types.

import Anthropic from '@anthropic-ai/sdk';
import CompetitorProject from '../models/competitorProjectModel.js';
import CompetitiveAnalysis from '../models/competitiveAnalysisModel.js';
import {
  getMarketOverview,
  removeOutliers,
  computeDataHash,
} from './competitiveDataService.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AI_MODEL = 'claude-sonnet-4-20250514';

// ─── System Prompt ───────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert Indian real estate market analyst. You provide data-driven recommendations based on competitive market data. All monetary values are in INR (Indian Rupees). You always respond with valid JSON matching the requested schema exactly. Never include markdown, comments, or explanation outside the JSON.`;

// ─── Analysis Type Prompts ───────────────────────────────────

const ANALYSIS_PROMPTS = {
  pricing_recommendations: (project, competitors, overview) => `
Analyze the competitive landscape and provide pricing recommendations for this real estate project.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects, outliers removed):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON with this exact schema:
{
  "optimalPricing": {
    "pricePerSqft": { "recommended": number, "range": { "min": number, "max": number }, "confidence": number },
    "floorRiseCharge": { "recommended": number, "range": { "min": number, "max": number } },
    "facingPremiums": {
      "parkFacing": { "recommended": number },
      "roadFacing": { "recommended": number },
      "cornerUnit": { "recommended": number }
    },
    "parkingCharges": { "covered": number, "open": number },
    "clubMembership": number,
    "maintenanceDeposit": number
  },
  "marketPositioning": {
    "segment": "budget|affordable|mid_segment|premium|luxury|ultra_luxury",
    "pricePercentile": number,
    "narrative": "string"
  },
  "recommendations": [
    {
      "category": "pricing",
      "priority": "critical|high|medium|low",
      "title": "string",
      "description": "string",
      "confidenceScore": number,
      "estimatedImpact": "string",
      "actionItems": ["string"]
    }
  ]
}`,

  revenue_planning: (project, competitors, overview) => `
Provide revenue planning analysis for this real estate project based on competitive data.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON:
{
  "revenueTargets": {
    "totalProjectRevenue": number,
    "revenuePerUnitType": [{ "unitType": "string", "avgPrice": number, "count": number, "revenue": number }],
    "priceEscalationStrategy": { "phase1": { "pricePerSqft": number, "duration": "string" }, "phase2": { "pricePerSqft": number, "duration": "string" }, "phase3": { "pricePerSqft": number, "duration": "string" } }
  },
  "recommendations": [
    { "category": "revenue", "priority": "string", "title": "string", "description": "string", "confidenceScore": number, "estimatedImpact": "string", "actionItems": ["string"] }
  ]
}`,

  absorption_rate: (project, competitors, overview) => `
Predict absorption rate and sales velocity for this project based on competitive market data.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON:
{
  "absorption": {
    "predictedMonthlySales": number,
    "timeToSellOut": { "months": number, "confidence": number },
    "priceSensitivity": [
      { "pricePoint": number, "estimatedMonthlySales": number, "timeToSellOut": number }
    ]
  },
  "recommendations": [
    { "category": "absorption", "priority": "string", "title": "string", "description": "string", "confidenceScore": number, "estimatedImpact": "string", "actionItems": ["string"] }
  ]
}`,

  demand_supply_gap: (project, competitors, overview) => `
Analyze demand-supply gap in this locality for this project.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON:
{
  "demandSupply": {
    "overallAssessment": "oversupply|balanced|undersupply",
    "byUnitType": [
      { "unitType": "string", "supply": number, "demandIndicator": "high|medium|low", "gap": "string" }
    ],
    "saturationIndicators": { "projectDensity": "string", "priceStability": "string", "inventoryAge": "string" }
  },
  "recommendations": [
    { "category": "demand_supply", "priority": "string", "title": "string", "description": "string", "confidenceScore": number, "estimatedImpact": "string", "actionItems": ["string"] }
  ]
}`,

  launch_timing: (project, competitors, overview) => `
Recommend optimal launch timing for this project based on competitive landscape.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON:
{
  "launchTiming": {
    "recommendedLaunchWindow": { "quarter": "string", "year": number, "reason": "string" },
    "competitorPipeline": [{ "status": "string", "count": number, "implication": "string" }],
    "seasonalFactors": [{ "period": "string", "demandLevel": "high|medium|low", "reason": "string" }],
    "preLaunchStrategy": { "duration": "string", "priceDiscount": number, "targetBookings": number }
  },
  "recommendations": [
    { "category": "launch_timing", "priority": "string", "title": "string", "description": "string", "confidenceScore": number, "estimatedImpact": "string", "actionItems": ["string"] }
  ]
}`,

  optimal_unit_mix: (project, competitors, overview) => `
Recommend optimal unit mix for this project based on market demand signals.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON:
{
  "unitMix": {
    "recommended": [
      { "unitType": "string", "percentage": number, "count": number, "carpetAreaRange": { "min": number, "max": number }, "pricePerSqftRange": { "min": number, "max": number }, "rationale": "string" }
    ],
    "marketDemandSignals": [{ "signal": "string", "source": "string", "impact": "string" }]
  },
  "recommendations": [
    { "category": "unit_mix", "priority": "string", "title": "string", "description": "string", "confidenceScore": number, "estimatedImpact": "string", "actionItems": ["string"] }
  ]
}`,

  marketing_strategy: (project, competitors, overview) => `
Develop marketing strategy recommendations based on competitive positioning.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON:
{
  "marketing": {
    "usps": ["string"],
    "competitiveAdvantages": ["string"],
    "competitiveDisadvantages": ["string"],
    "pricingNarrative": "string",
    "targetBuyerPersona": { "demographics": "string", "motivations": ["string"], "concerns": ["string"] },
    "keySellingPoints": ["string"],
    "channelRecommendations": [{ "channel": "string", "priority": "high|medium|low", "reason": "string" }]
  },
  "recommendations": [
    { "category": "marketing", "priority": "string", "title": "string", "description": "string", "confidenceScore": number, "estimatedImpact": "string", "actionItems": ["string"] }
  ]
}`,

  comprehensive: (project, competitors, overview) => `
Provide a comprehensive competitive analysis covering ALL aspects: pricing, revenue, absorption, demand-supply, launch timing, unit mix, and marketing.

PROJECT DATA:
${JSON.stringify(project, null, 2)}

COMPETITOR DATA (${competitors.length} projects):
${JSON.stringify(competitors, null, 2)}

MARKET OVERVIEW:
${JSON.stringify(overview, null, 2)}

Return JSON with this schema:
{
  "pricing": { "optimalPricePerSqft": number, "range": { "min": number, "max": number }, "segment": "string", "pricePercentile": number },
  "revenue": { "totalTarget": number, "escalationStrategy": "string" },
  "absorption": { "monthlySales": number, "timeToSellOut": number },
  "demandSupply": { "assessment": "string", "gaps": ["string"] },
  "launchTiming": { "recommended": "string", "reason": "string" },
  "unitMix": [{ "unitType": "string", "percentage": number, "rationale": "string" }],
  "marketing": { "usps": ["string"], "targetBuyer": "string", "keyMessage": "string" },
  "marketPositioning": {
    "segment": "budget|affordable|mid_segment|premium|luxury|ultra_luxury",
    "pricePercentile": number,
    "advantages": ["string"],
    "disadvantages": ["string"]
  },
  "recommendations": [
    { "category": "string", "priority": "string", "title": "string", "description": "string", "confidenceScore": number, "estimatedImpact": "string", "actionItems": ["string"] }
  ]
}`,
};

// ─── Data Quality Assessment ─────────────────────────────────

const assessDataQuality = (competitors) => {
  if (competitors.length === 0) return 'very_low';

  const now = Date.now();
  let freshCount = 0;
  let recentCount = 0;
  let staleCount = 0;
  let totalConfidence = 0;

  for (const c of competitors) {
    const ageDays = (now - new Date(c.dataCollectionDate).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) freshCount++;
    else if (ageDays < 90) recentCount++;
    else staleCount++;
    totalConfidence += c.confidenceScore || 50;
  }

  const avgConfidence = totalConfidence / competitors.length;
  const freshRatio = freshCount / competitors.length;

  if (freshRatio >= 0.7 && avgConfidence >= 60 && competitors.length >= 5) return 'high';
  if (freshRatio >= 0.4 && avgConfidence >= 40 && competitors.length >= 3) return 'medium';
  if (competitors.length >= 2) return 'low';
  return 'very_low';
};

// ─── Core Analysis Function ──────────────────────────────────

/**
 * Generate or retrieve cached AI competitive analysis.
 *
 * @param {Object} params
 * @param {ObjectId} params.organizationId
 * @param {ObjectId} params.projectId
 * @param {string} params.analysisType
 * @param {ObjectId} params.userId
 * @param {boolean} [params.forceRefresh=false]
 * @returns {Object} Analysis results
 */
const generateAnalysis = async ({
  organizationId,
  projectId,
  analysisType,
  userId,
  forceRefresh = false,
}) => {
  // Dynamically import Project to avoid circular dependencies
  const { default: Project } = await import('../models/projectModel.js');

  const startTime = Date.now();

  // ── Step 1: Load project ─────────────────────────────────
  const project = await Project.findOne({
    _id: projectId,
    organization: organizationId,
  }).lean();

  if (!project) {
    throw new Error('Project not found');
  }

  const city = project.location?.city;
  const area = project.location?.area;

  if (!city || !area) {
    throw new Error('Project must have location.city and location.area set');
  }

  // ── Step 2: Load competitors ─────────────────────────────
  const allCompetitors = await CompetitorProject.find({
    organization: organizationId,
    'location.city': new RegExp(`^${city.trim()}$`, 'i'),
    'location.area': new RegExp(`^${area.trim()}$`, 'i'),
    isActive: true,
  })
    .sort({ confidenceScore: -1 })
    .limit(20)
    .lean();

  if (allCompetitors.length === 0) {
    throw new Error(
      `No competitor data found for ${area}, ${city}. Add competitors or run AI Research first.`
    );
  }

  // Data hash for cache invalidation
  const currentDataHash = computeDataHash(allCompetitors);

  // ── Step 3: Check cache ──────────────────────────────────
  if (!forceRefresh) {
    const cached = await CompetitiveAnalysis.findOne({
      organization: organizationId,
      'analysisScope.project': projectId,
      analysisType,
      isExpired: false,
      dataHashAtGeneration: currentDataHash,
    });

    if (cached) {
      return {
        ...cached.toObject(),
        fromCache: true,
      };
    }
  }

  // ── Step 4: Prepare data (remove outliers from pricing) ──
  const priceValues = allCompetitors
    .map((c) => c.pricing?.pricePerSqft?.avg)
    .filter((v) => v && v > 0);
  const { cleaned: cleanedPrices } = removeOutliers(priceValues);

  // Filter competitors to those within cleaned price range
  const minClean = cleanedPrices.length > 0 ? Math.min(...cleanedPrices) : 0;
  const maxClean = cleanedPrices.length > 0 ? Math.max(...cleanedPrices) : Infinity;

  const filteredCompetitors = allCompetitors.filter((c) => {
    const avg = c.pricing?.pricePerSqft?.avg;
    if (!avg) return true; // Keep entries without pricing
    return avg >= minClean && avg <= maxClean;
  });

  // Slim down competitor data for the prompt to save tokens
  const slimCompetitors = filteredCompetitors.map((c) => ({
    projectName: c.projectName,
    developerName: c.developerName,
    projectStatus: c.projectStatus,
    totalUnits: c.totalUnits,
    pricing: c.pricing,
    unitMix: c.unitMix?.map((u) => ({
      unitType: u.unitType,
      carpetAreaRange: u.carpetAreaRange,
      priceRange: u.priceRange,
      totalCount: u.totalCount,
    })),
    amenities: c.amenities,
    confidenceScore: c.confidenceScore,
  }));

  // Get market overview
  const overview = await getMarketOverview(organizationId, city, area);

  // Slim project data
  const slimProject = {
    name: project.name,
    type: project.type,
    status: project.status,
    location: project.location,
    totalUnits: project.totalUnits,
    priceRange: project.priceRange,
    targetRevenue: project.targetRevenue,
    launchDate: project.launchDate,
    amenities: project.amenities,
    pricingRules: project.pricingRules,
  };

  // ── Step 5: Call Claude for analysis ─────────────────────
  const promptBuilder = ANALYSIS_PROMPTS[analysisType];
  if (!promptBuilder) {
    throw new Error(`Unknown analysis type: ${analysisType}`);
  }

  const userPrompt = promptBuilder(slimProject, slimCompetitors, overview);

  let parsed;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: AI_MODEL,
        max_tokens: 8000,
        temperature: attempt === 1 ? 0.3 : 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const content = response.content[0].text;
      parsed = JSON.parse(content);
      break;
    } catch (err) {
      if (attempt === 2) {
        throw new Error(`AI analysis failed after 2 attempts: ${err.message}`);
      }
    }
  }

  // ── Step 6: Extract recommendations and positioning ──────
  const recommendations = parsed.recommendations || [];
  const marketPositioning = parsed.marketPositioning || parsed.pricing?.segment
    ? {
        segment: parsed.marketPositioning?.segment || parsed.pricing?.segment,
        pricePercentile: parsed.marketPositioning?.pricePercentile || parsed.pricing?.pricePercentile,
        competitiveAdvantages: parsed.marketPositioning?.advantages || parsed.marketing?.competitiveAdvantages || [],
        competitiveDisadvantages: parsed.marketPositioning?.disadvantages || parsed.marketing?.competitiveDisadvantages || [],
      }
    : undefined;

  const dataQuality = assessDataQuality(allCompetitors);
  const generationTimeMs = Date.now() - startTime;

  // Compute freshness for metadata
  const now = Date.now();
  let freshCount = 0;
  let recentCount = 0;
  let staleCount = 0;
  for (const c of allCompetitors) {
    const ageDays = (now - new Date(c.dataCollectionDate).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < 30) freshCount++;
    else if (ageDays < 90) recentCount++;
    else staleCount++;
  }

  // ── Step 7: Save to DB (upsert to prevent duplicates) ────
  const analysis = await CompetitiveAnalysis.findOneAndUpdate(
    {
      organization: organizationId,
      'analysisScope.project': projectId,
      analysisType,
    },
    {
      $set: {
        analysisScope: {
          project: projectId,
          city,
          area,
          competitorProjectIds: allCompetitors.map((c) => c._id),
          competitorCount: allCompetitors.length,
        },
        results: parsed,
        recommendations,
        marketPositioning,
        metadata: {
          model: AI_MODEL,
          generationTimeMs,
          promptVersion: '1.0',
          dataQuality,
          competitorDataFreshness: { freshCount, recentCount, staleCount },
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isExpired: false,
        dataHashAtGeneration: currentDataHash,
        requestedBy: userId,
      },
      $setOnInsert: {
        organization: organizationId,
      },
    },
    { upsert: true, new: true }
  );

  return {
    ...analysis.toObject(),
    fromCache: false,
  };
};

export { generateAnalysis };
