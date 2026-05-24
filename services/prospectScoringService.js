// File: services/prospectScoringService.js
// CP-side prospect scoring. Mirrors the dev-side leadScoringService formula
// shape (0–100 + grade + breakdown) so the CP and dev see comparable signals,
// but reads only the inputs the CP actually has:
//
//   • Budget specified?      — 30% weight (no project-pricing comparison
//                              here; CPs aren't always pushing to a known
//                              project, so we score on "are min/max set
//                              and reasonable" only)
//   • Engagement             — 25% weight (activity count + recency of
//                              latest activity as proxy for "is this
//                              prospect being actively worked")
//   • Timeline urgency       — 20% weight (Prospect.requirements.timeline)
//   • Recency of prospect    — 10% weight
//
// Total weights sum to 0.85, intentionally — the missing 15% is the dev-side
// "source quality" factor, which on the CP side is implicitly always
// "referral" (CP itself is the source). We multiply the final result by
// 100/85 so the score is still on a comparable 0–100 scale.
//
// The score is exposed to the CP as Prospect.score / scoreGrade so they can
// prioritize their own pipeline before deciding what to push to the dev.

import Prospect from '../models/prospectModel.js';

const PROSPECT_SCORING_CONFIG = {
  budgetAlignment: {
    weight: 0.30,
    rules: {
      bothSet: 90,    // both min and max provided
      oneSet: 60,     // only one bound
      noBudget: 30,
    },
  },
  engagementLevel: {
    weight: 0.25,
    rules: {
      highEngagement: 100,   // 5+ activities AND a recent one
      mediumEngagement: 75,  // 2–4 activities OR a recent one
      lowEngagement: 50,     // 1 activity
      noEngagement: 15,
    },
  },
  timelineUrgency: {
    weight: 0.20,
    rules: {
      immediate: 100,
      within3Months: 85,
      within6Months: 65,
      within12Months: 45,
      longTerm: 25,
      noTimeline: 35,
    },
  },
  recencyFactor: {
    weight: 0.10,
    rules: {
      within24Hours: 100,
      within7Days: 85,
      within30Days: 70,
      within90Days: 50,
      older: 25,
    },
  },
};

// Total weight is 0.85; rescale to 0–100 at the end.
const TOTAL_WEIGHT = 0.85;

const calculateBudget = (p, cfg) => {
  const hasMin = p.budget?.min != null && p.budget.min > 0;
  const hasMax = p.budget?.max != null && p.budget.max > 0;
  let raw, reasoning;
  if (hasMin && hasMax) { raw = cfg.rules.bothSet; reasoning = 'Budget range specified'; }
  else if (hasMin || hasMax) { raw = cfg.rules.oneSet; reasoning = 'Partial budget specified'; }
  else { raw = cfg.rules.noBudget; reasoning = 'No budget specified'; }
  return { rawScore: raw, weightedScore: raw * cfg.weight, reasoning };
};

const calculateEngagement = (p, cfg) => {
  const acts = Array.isArray(p.activities) ? p.activities : [];
  const count = acts.length;
  const last = acts[acts.length - 1];
  const lastAt = last?.at ? new Date(last.at) : null;
  const ageDays = lastAt
    ? Math.max(0, Math.floor((Date.now() - lastAt.getTime()) / (24 * 60 * 60 * 1000)))
    : Infinity;
  const recentlyTouched = ageDays <= 14;

  let raw, reasoning;
  if (count >= 5 && recentlyTouched) { raw = cfg.rules.highEngagement; reasoning = `${count} activities, recent contact`; }
  else if (count >= 2 || recentlyTouched) { raw = cfg.rules.mediumEngagement; reasoning = `${count} activities`; }
  else if (count === 1) { raw = cfg.rules.lowEngagement; reasoning = 'One activity logged'; }
  else { raw = cfg.rules.noEngagement; reasoning = 'No activities yet'; }
  return { rawScore: raw, weightedScore: raw * cfg.weight, reasoning };
};

const calculateTimeline = (p, cfg) => {
  const t = p.requirements?.timeline;
  let raw, reasoning;
  if (!t)                       { raw = cfg.rules.noTimeline;     reasoning = 'No timeline specified'; }
  else if (t === 'immediate')   { raw = cfg.rules.immediate;      reasoning = 'Immediate purchase intent'; }
  else if (t === '1-3_months')  { raw = cfg.rules.within3Months;  reasoning = 'Short-term (1–3 months)'; }
  else if (t === '3-6_months')  { raw = cfg.rules.within6Months;  reasoning = 'Medium-term (3–6 months)'; }
  else if (t === '6-12_months') { raw = cfg.rules.within12Months; reasoning = 'Long-term (6–12 months)'; }
  else                          { raw = cfg.rules.longTerm;       reasoning = 'Very long-term (12+ months)'; }
  return { rawScore: raw, weightedScore: raw * cfg.weight, reasoning };
};

const calculateRecency = (p, cfg) => {
  const createdAt = p.createdAt ? new Date(p.createdAt) : new Date();
  const ageDays = Math.floor((Date.now() - createdAt.getTime()) / (24 * 60 * 60 * 1000));
  let raw, reasoning;
  if (ageDays <= 1)       { raw = cfg.rules.within24Hours; reasoning = 'Created within 24 hours'; }
  else if (ageDays <= 7)  { raw = cfg.rules.within7Days;   reasoning = 'Created within 7 days'; }
  else if (ageDays <= 30) { raw = cfg.rules.within30Days;  reasoning = 'Created within 30 days'; }
  else if (ageDays <= 90) { raw = cfg.rules.within90Days;  reasoning = 'Created within 90 days'; }
  else                    { raw = cfg.rules.older;         reasoning = '90+ days old'; }
  return { rawScore: raw, weightedScore: raw * cfg.weight, reasoning };
};

const getGrade = (score) => {
  if (score >= 75) return 'Hot';
  if (score >= 55) return 'Warm';
  if (score >= 35) return 'Cold';
  return 'Very Cold';
};

export const calculateProspectScore = (prospect) => {
  const cfg = PROSPECT_SCORING_CONFIG;
  const breakdown = {
    budgetAlignment: calculateBudget(prospect, cfg.budgetAlignment),
    engagementLevel: calculateEngagement(prospect, cfg.engagementLevel),
    timelineUrgency: calculateTimeline(prospect, cfg.timelineUrgency),
    recencyFactor:   calculateRecency(prospect, cfg.recencyFactor),
  };
  const weightedSum =
    breakdown.budgetAlignment.weightedScore +
    breakdown.engagementLevel.weightedScore +
    breakdown.timelineUrgency.weightedScore +
    breakdown.recencyFactor.weightedScore;
  // Rescale from 0–85 → 0–100.
  const score = Math.max(0, Math.min(100, Math.round((weightedSum / TOTAL_WEIGHT) * 100) / 100));
  return { score, grade: getGrade(score), breakdown };
};

// Update the Prospect doc in-place. Uses updateOne so we don't trip pre-save
// hooks (no scoring chain reactions). Best-effort; non-fatal on error.
export const updateProspectScore = async (prospectId) => {
  try {
    const p = await Prospect.findById(prospectId).select(
      'budget activities requirements createdAt'
    ).lean();
    if (!p) return null;
    const { score, grade, breakdown } = calculateProspectScore(p);
    await Prospect.updateOne(
      { _id: prospectId },
      {
        $set: {
          score,
          scoreGrade: grade,
          scoreBreakdown: breakdown,
          lastScoreUpdate: new Date(),
        },
      }
    );
    return { score, grade, breakdown };
  } catch (err) {
    console.warn('[updateProspectScore] failed (non-fatal):', err.message);
    return null;
  }
};

// Mirror a freshly-computed Lead.score back onto the source Prospect so the
// CP can see how the developer is rating the same person. Called from the
// dev-side lead scoring service whenever a CP-attributed Lead is rescored.
export const mirrorLeadScoreToProspect = async (prospectId, leadScore, leadGrade) => {
  try {
    if (!prospectId || leadScore == null) return;
    await Prospect.updateOne(
      { _id: prospectId },
      {
        $set: {
          devScore: leadScore,
          devScoreGrade: leadGrade || null,
          devScoreUpdatedAt: new Date(),
        },
      }
    );
  } catch (err) {
    console.warn('[mirrorLeadScoreToProspect] failed (non-fatal):', err.message);
  }
};
