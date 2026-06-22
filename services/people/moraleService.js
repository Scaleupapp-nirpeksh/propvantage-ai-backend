// File: services/people/moraleService.js
// Description: AI sentiment analysis per reflection and weekly morale roll-ups
//   for the People & Performance module (spec §11).
//
//   analyzeReflection(doc)                → { score, label, themes, riskSignals } | null
//   buildTeamMorale(orgId, headUser, isoWeek) → MoraleSummaryDoc
//   buildOrgMorale(orgId, isoWeek)           → MoraleSummaryDoc
//
// Anthropic client follows the pattern in services/scorecardAIService.js.
// JSON parsing follows aiCopilotService.js (fenced-block fallback, defensive).
// NEVER throws to caller from analyzeReflection — always returns null on error.

import Anthropic from '@anthropic-ai/sdk';
import WeeklyReflection from '../../models/weeklyReflectionModel.js';
import MoraleSummary from '../../models/moraleSummaryModel.js';
import { getTeam } from './hierarchyService.js';
import { previousIsoWeek } from '../../utils/isoWeek.js';

// =============================================================================
// CLIENT
// =============================================================================

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.MORALE_AI_MODEL || 'claude-sonnet-4-6';

// =============================================================================
// JSON PARSE HELPERS (mirror aiCopilotService / scorecardAIService approach)
// =============================================================================

/**
 * Extract text from an Anthropic messages response and parse as JSON.
 * Handles optional ```json ... ``` fenced blocks.
 * Returns null if anything goes wrong.
 *
 * @param {import('@anthropic-ai/sdk').Message} response
 * @returns {object|null}
 */
function extractJSON(response) {
  const textBlock = response.content?.find((b) => b.type === 'text');
  if (!textBlock) return null;

  let jsonText = textBlock.text.trim();
  // Strip a possible ```json ... ``` fence
  const fence = jsonText.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) jsonText = fence[1].trim();

  return JSON.parse(jsonText); // caller catches
}

// =============================================================================
// SENTIMENT SYSTEM PROMPT
// =============================================================================

const SENTIMENT_SYSTEM = `You are an organisational psychologist analysing a real estate professional's weekly reflection for their manager. You ALWAYS respond with valid JSON only — no markdown, no prose, no text outside the JSON object.

Analyse the five answers and return:
{
  "score": <number -1.0 to 1.0, two decimal places>,
  "label": "<positive|neutral|negative>",
  "themes": ["<short theme string>", ...],
  "riskSignals": ["<zero or more of: burnout, frustration, blocked-on-others, flight-risk, recognition, workload>"]
}

Rules:
- score: -1 = extremely negative sentiment, 0 = neutral, +1 = extremely positive. Round to 2 decimal places.
- label: derive from score: ≥0.15 → positive, ≤ -0.15 → negative, else neutral.
- themes: up to 6 short strings (e.g. "strong week", "team collaboration", "process friction").
- riskSignals: only include a signal if there is clear textual evidence. Use ONLY the listed values.
- If an answer is very short or uninformative, weight it less; do not fabricate sentiment.
Respond ONLY with the JSON object — no wrapping text.`;

// =============================================================================
// MORALE SYSTEM PROMPT
// =============================================================================

const MORALE_SYSTEM = `You are an organisational psychologist generating a weekly team-morale summary for a manager. You ALWAYS respond with valid JSON only — no markdown, no prose, no text outside the JSON object.

Given a set of reflections (each with wins, areasToImprove, dislikes, achievements, plansNextWeek, and pre-computed sentiment score/label/themes/riskSignals), produce:
{
  "moraleScore": <integer 0..100>,
  "narrative": "<2-4 sentence plain-English summary for the manager>",
  "topPositiveThemes": ["<theme>", ...],
  "topNegativeThemes": ["<theme>", ...],
  "peopleToCheckIn": [{ "userId": "<string>", "reason": "<short reason>" }, ...],
  "risks": ["<org-level risk string>", ...]
}

Rules:
- moraleScore: 0=terrible, 50=neutral/mixed, 100=outstanding. Derive from the distribution of sentiment scores and risk signals.
- narrative: factual, specific to this week, no names (refer to "team members").
- topPositiveThemes: up to 5 most-common positive themes across all reflections.
- topNegativeThemes: up to 5 most-common negative themes/frustrations.
- peopleToCheckIn: list userId strings for anyone with negative sentiment OR serious risk signals (burnout, flight-risk). Max 5.
- risks: org/team-level risk strings distilled from riskSignals patterns (e.g. "widespread burnout signals", "blocked delivery pipeline").
Respond ONLY with the JSON object.`;

// =============================================================================
// analyzeReflection
// =============================================================================

/**
 * Use Claude to analyse the sentiment of a submitted reflection.
 * Persists the result onto the reflection document.
 *
 * BEST-EFFORT — any error (network, parse, validation) returns null and
 * never throws to the caller.
 *
 * @param {import('mongoose').Document} reflectionDoc
 * @returns {Promise<{score:number,label:string,themes:string[],riskSignals:string[]}|null>}
 */
export async function analyzeReflection(reflectionDoc) {
  try {
    const { answers } = reflectionDoc;

    const userContent = [
      `Wins this week:\n${answers.wins || '(not provided)'}`,
      `Areas to improve:\n${answers.areasToImprove || '(not provided)'}`,
      `Things disliked:\n${answers.dislikes || '(not provided)'}`,
      `Achievements:\n${answers.achievements || '(not provided)'}`,
      `Plans for next week:\n${answers.plansNextWeek || '(not provided)'}`,
    ].join('\n\n');

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      temperature: 0.1,
      system: SENTIMENT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Analyse the following weekly reflection:\n\n${userContent}`,
        },
      ],
    });

    let parsed;
    try {
      parsed = extractJSON(response);
    } catch {
      console.error('[moraleService:analyzeReflection] JSON parse failed — returning null');
      return null;
    }

    if (!parsed || typeof parsed.score !== 'number' || !parsed.label) {
      console.error('[moraleService:analyzeReflection] Unexpected response shape — returning null');
      return null;
    }

    // Normalise
    const result = {
      score:       Math.max(-1, Math.min(1, Number(parsed.score.toFixed(2)))),
      label:       ['positive', 'neutral', 'negative'].includes(parsed.label)
        ? parsed.label
        : (parsed.score >= 0.15 ? 'positive' : parsed.score <= -0.15 ? 'negative' : 'neutral'),
      themes:      Array.isArray(parsed.themes) ? parsed.themes.slice(0, 6) : [],
      riskSignals: Array.isArray(parsed.riskSignals) ? parsed.riskSignals.filter((s) =>
        ['burnout', 'frustration', 'blocked-on-others', 'flight-risk', 'recognition', 'workload'].includes(s)
      ) : [],
    };

    // Persist onto the reflection — best-effort (don't let a save error propagate)
    try {
      reflectionDoc.sentiment = {
        ...result,
        analyzedAt: new Date(),
        model: MODEL,
      };
      await reflectionDoc.save();
    } catch (saveErr) {
      console.error('[moraleService:analyzeReflection] Failed to persist sentiment:', saveErr.message);
      // Return result anyway — the analysis itself succeeded
    }

    return result;
  } catch (err) {
    console.error('[moraleService:analyzeReflection] Error:', err.message);
    return null;
  }
}

// =============================================================================
// SHARED ROLL-UP BUILDER
// =============================================================================

/**
 * Summarise a set of submitted reflections via Claude and upsert a MoraleSummary.
 *
 * @param {object} opts
 * @param {string|import('mongoose').Types.ObjectId} opts.orgId
 * @param {string}  opts.scope          - 'team' | 'org'
 * @param {object|null} opts.headUser   - the Head user doc (null for org scope)
 * @param {string}  opts.isoWeek        - 'YYYY-Www'
 * @param {object[]} opts.reflections   - submitted reflection docs (lean)
 * @returns {Promise<import('mongoose').Document>} MoraleSummary document
 */
async function buildMoraleSummary({ orgId, scope, headUser, isoWeek, reflections }) {
  const count = reflections.length;

  // Build a compact payload for Claude
  const payload = reflections.map((r) => ({
    userId:  String(r.user),
    answers: {
      wins:           (r.answers?.wins           || '').slice(0, 600),
      areasToImprove: (r.answers?.areasToImprove || '').slice(0, 600),
      dislikes:       (r.answers?.dislikes       || '').slice(0, 600),
      achievements:   (r.answers?.achievements   || '').slice(0, 600),
      plansNextWeek:  (r.answers?.plansNextWeek  || '').slice(0, 600),
    },
    sentiment: r.sentiment
      ? {
          score:       r.sentiment.score,
          label:       r.sentiment.label,
          themes:      r.sentiment.themes || [],
          riskSignals: r.sentiment.riskSignals || [],
        }
      : null,
  }));

  let parsed = null;

  if (count > 0) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1200,
        temperature: 0.1,
        system: MORALE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Week: ${isoWeek}\nScope: ${scope}\nReflections (${count}):\n${JSON.stringify(payload, null, 2)}`,
          },
        ],
      });

      parsed = extractJSON(response);
    } catch (err) {
      console.error(`[moraleService:buildMoraleSummary] Claude call failed (${scope}):`, err.message);
    }
  }

  // Defensive defaults when Claude failed or no reflections
  const moraleScore = (parsed && typeof parsed.moraleScore === 'number')
    ? Math.max(0, Math.min(100, Math.round(parsed.moraleScore)))
    : 50;

  const narrative = (parsed && typeof parsed.narrative === 'string')
    ? parsed.narrative.trim()
    : count === 0
      ? 'No reflections were submitted this week — no morale data available.'
      : 'Morale analysis could not be generated this week.';

  const topPositiveThemes = Array.isArray(parsed?.topPositiveThemes)
    ? parsed.topPositiveThemes.slice(0, 5)
    : [];

  const topNegativeThemes = Array.isArray(parsed?.topNegativeThemes)
    ? parsed.topNegativeThemes.slice(0, 5)
    : [];

  // Map peopleToCheckIn userId strings → ObjectId objects that match reflection user ids
  const reflectionUserIds = new Set(reflections.map((r) => String(r.user)));
  const peopleToCheckIn = Array.isArray(parsed?.peopleToCheckIn)
    ? parsed.peopleToCheckIn
        .filter((p) => p?.userId && reflectionUserIds.has(p.userId))
        .slice(0, 5)
        .map((p) => ({ user: p.userId, reason: p.reason || '' }))
    : [];

  const risks = Array.isArray(parsed?.risks) ? parsed.risks.slice(0, 10) : [];

  // Fetch last week's score for trend calculation
  let trendVsLastWeek = null;
  try {
    const priorIsoWeek = previousIsoWeek(isoWeek);

    const prior = await MoraleSummary.findOne({
      organization: orgId,
      scope,
      head: headUser ? headUser._id : null,
      isoWeek: priorIsoWeek,
    }).lean();

    if (prior != null) {
      trendVsLastWeek = moraleScore - prior.moraleScore;
    }
  } catch {
    // trend is best-effort
  }

  const doc = await MoraleSummary.findOneAndUpdate(
    {
      organization:  orgId,
      scope,
      head:          headUser ? headUser._id : null,
      isoWeek,
    },
    {
      $set: {
        moraleScore,
        trendVsLastWeek,
        narrative,
        topPositiveThemes,
        topNegativeThemes,
        peopleToCheckIn,
        risks,
        reflectionsAnalyzed: count,
        generatedAt: new Date(),
      },
    },
    { upsert: true, new: true, runValidators: true }
  );

  return doc;
}

// =============================================================================
// buildTeamMorale
// =============================================================================

/**
 * Gather the prior week's submitted reflections for the head's team and
 * build (upsert) a 'team'-scoped MoraleSummary.
 *
 * @param {string|import('mongoose').Types.ObjectId} orgId
 * @param {object} headUser   - Head user document (must have ._id, .role, .organization)
 * @param {string} isoWeek    - 'YYYY-Www' — the week to summarise
 * @returns {Promise<import('mongoose').Document>}
 */
export async function buildTeamMorale(orgId, headUser, isoWeek) {
  const teamMembers = await getTeam(headUser);
  const memberIds   = teamMembers.map((m) => m._id);

  const reflections = await WeeklyReflection.find({
    organization: orgId,
    isoWeek,
    status: 'submitted',
    user: { $in: memberIds },
  }).lean();

  return buildMoraleSummary({
    orgId,
    scope: 'team',
    headUser,
    isoWeek,
    reflections,
  });
}

// =============================================================================
// buildOrgMorale
// =============================================================================

/**
 * Gather all submitted reflections for the org in `isoWeek` and build
 * (upsert) an 'org'-scoped MoraleSummary.
 *
 * @param {string|import('mongoose').Types.ObjectId} orgId
 * @param {string} isoWeek  - 'YYYY-Www'
 * @returns {Promise<import('mongoose').Document>}
 */
export async function buildOrgMorale(orgId, isoWeek) {
  const reflections = await WeeklyReflection.find({
    organization: orgId,
    isoWeek,
    status: 'submitted',
  }).lean();

  return buildMoraleSummary({
    orgId,
    scope: 'org',
    headUser: null,
    isoWeek,
    reflections,
  });
}

export default { analyzeReflection, buildTeamMorale, buildOrgMorale };
