// File: services/home/intentRouter.js
// Description: Classifies a user's plain-English Home request into ONE intent —
//   action (navigate to create/open a page), data (a validated My-View card the
//   UI can render + add to My View), question (hand off to the Copilot), or
//   clarify. Uses Claude with a forced single tool. Best-effort & safe: never
//   throws; degrades a bad data plan to a question and unmappable input to clarify.
//   Mirrors services/workspace/nlToQueryPlan.js (catalog vocab + validation).
import Anthropic from '@anthropic-ai/sdk';
import { validateQueryPlan, MODULES } from '../workspace/queryPlanSchema.js';
import { getCatalog, listCatalogModules } from '../workspace/catalogs/index.js';

const MODEL = process.env.WORKSPACE_NL_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Number(process.env.HOME_INTENT_MAX_TOKENS) || 1024;
const DEFAULT_LIMIT = 50;

// Entities the user can act on from Home (create page / open module list).
const ACTION_ENTITIES = ['lead', 'project', 'sale', 'task', 'payment', 'channelPartner'];

// Lazy, quote-tolerant Anthropic client (same approach as the NL→QueryPlan service).
let _client = null;
const getClient = () => {
  if (_client) return _client;
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '');
  if (apiKey) _client = new Anthropic({ apiKey });
  return _client;
};

// Compact model-facing vocabulary across all modules (for the data branch).
const moduleVocab = (moduleKey) => {
  let catalog;
  try { catalog = getCatalog(moduleKey); } catch { return null; }
  if (!catalog) return null;
  const fields = catalog.fields.map((f) => {
    const entry = { key: f.key, label: f.label, type: f.type, operators: f.operators };
    if (Array.isArray(f.enumValues) && f.enumValues.length) entry.enumValues = f.enumValues;
    return entry;
  });
  return { module: moduleKey, fields };
};
const buildVocab = () => listCatalogModules().map(moduleVocab).filter(Boolean);

// Catalog validation for a data plan: every field exists and every op is allowed.
const catalogViolation = (plan, moduleKey) => {
  let catalog;
  try { catalog = getCatalog(moduleKey); } catch { return `Unknown module "${moduleKey}".`; }
  if (!catalog) return `Unknown module "${moduleKey}".`;
  const byKey = new Map(catalog.fields.map((f) => [f.key, f]));
  for (const f of plan.filters || []) {
    const fd = byKey.get(f.field);
    if (!fd) return `Unknown field "${f.field}" for ${moduleKey}.`;
    if (!fd.operators.includes(f.op)) return `Field "${fd.label}" can't use "${f.op}".`;
  }
  if (plan.sort && plan.sort.field && !byKey.has(plan.sort.field)) {
    return `Can't sort by "${plan.sort.field}" for ${moduleKey}.`;
  }
  return null;
};

const SYSTEM_PROMPT = [
  'You route a CRM user\'s plain-English request from their home screen into exactly ONE intent.',
  'Call the route_intent tool exactly once. Choose "kind":',
  '- "action": the user wants to CREATE, add, log, or open/go-to a record type (e.g. "create a lead",',
  '  "log a sale", "new task", "take me to projects"). Set "entity" to one of',
  `  ${ACTION_ENTITIES.join(', ')} and "mode" to "create" (make a new one) or "open" (go to its list).`,
  '- "data": the user wants to SEE/list/count/rank records (e.g. "leads with no follow-up in 30 days",',
  '  "how many bookings this month", "top stale CP leads"). Compile it over ONE module using ONLY fields',
  '  and operators from the FIELD VOCABULARY. Set "module", a short "title", "renderMode" ("metric" when',
  '  the answer is a single number — how many / total / count / revenue — else "list"), "filters", and',
  '  optional "sort"; for a "metric" that sums a numeric field set "metricField".',
  '- "question": an open-ended/analytical question best answered in prose (e.g. "how is business this',
  '  month?", "why are collections down?", "what should I focus on?"). Just set kind="question".',
  '- "clarify": too vague to route — set a short "clarification" question.',
  'Never invent field keys or operators. Prefer "data" over "question" when the request maps cleanly to',
  'a single module\'s fields; prefer "question" for analysis/advice that spans modules or needs reasoning.',
].join(' ');

const routeIntentTool = (vocab) => ({
  name: 'route_intent',
  description: 'Route the request into one intent. FIELD VOCABULARY (for kind="data"): ' + JSON.stringify(vocab),
  input_schema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['action', 'data', 'question', 'clarify'], description: 'The chosen intent.' },
      // action
      entity: { type: 'string', enum: ACTION_ENTITIES, description: 'For kind=action: the record type.' },
      mode: { type: 'string', enum: ['create', 'open'], description: 'For kind=action: make new vs open list.' },
      // data
      module: { type: 'string', enum: MODULES, description: 'For kind=data: target module.' },
      title: { type: 'string', description: 'For kind=data: a short card title.' },
      renderMode: { type: 'string', enum: ['list', 'metric'], description: 'For kind=data: list of rows or a single metric.' },
      metricField: { type: ['string', 'null'], description: 'For kind=data metric: numeric field to sum (else count).' },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string' },
            op: { type: 'string' },
            value: {},
          },
          required: ['field', 'op'],
        },
      },
      sort: {
        type: ['object', 'null'],
        properties: { field: { type: 'string' }, dir: { type: 'string', enum: ['asc', 'desc'] } },
      },
      limit: { type: 'number' },
      clarification: { type: 'string', description: 'For kind=clarify: a short question to the user.' },
    },
    required: ['kind'],
  },
});

/**
 * Route a Home request into a single intent.
 * @param {string} text user's plain-English request
 * @param {object} [opts]
 * @param {object} [opts.client] injected Anthropic client (tests pass a fake)
 * @returns {Promise<object>} one of:
 *   { kind:'action', entity, mode, label }
 *   { kind:'data', card:{ title, module, renderMode, queryPlan, metricConfig } }
 *   { kind:'question', text }
 *   { kind:'clarify', clarification }
 */
export const routeHomeIntent = async (text, { client } = {}) => {
  const trimmed = (text || '').trim();
  if (!trimmed) return { kind: 'clarify', clarification: 'Tell me what you\'d like to do.' };

  const anthropic = client || getClient();
  if (!anthropic) return { kind: 'question', text: trimmed }; // no AI config → let the Copilot try

  const tool = routeIntentTool(buildVocab());

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'route_intent' },
      messages: [{ role: 'user', content: trimmed }],
    });
  } catch (err) {
    return { kind: 'clarify', clarification: `I couldn't reach the AI service (${err.message}).` };
  }

  const blocks = Array.isArray(resp?.content) ? resp.content : [];
  const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'route_intent');
  if (!toolUse || !toolUse.input || typeof toolUse.input !== 'object') {
    return { kind: 'clarify', clarification: 'Could you rephrase that?' };
  }
  const out = toolUse.input;

  // ── action ────────────────────────────────────────────────────────────────
  if (out.kind === 'action' && ACTION_ENTITIES.includes(out.entity)) {
    const mode = out.mode === 'open' ? 'open' : 'create';
    const noun = out.entity === 'channelPartner' ? 'channel partner' : out.entity;
    const label = mode === 'open' ? `Open ${noun}s` : `Create a new ${noun}`;
    return { kind: 'action', entity: out.entity, mode, label };
  }

  // ── data ──────────────────────────────────────────────────────────────────
  if (out.kind === 'data' && out.module) {
    const candidate = {
      module: out.module,
      logic: 'AND',
      filters: Array.isArray(out.filters) ? out.filters : [],
      sort: out.sort && out.sort.field ? { field: out.sort.field, dir: out.sort.dir === 'asc' ? 'asc' : 'desc' } : null,
      limit: Number.isFinite(out.limit) ? out.limit : DEFAULT_LIMIT,
      nlSource: trimmed,
    };
    const { value, error } = validateQueryPlan(candidate);
    if (error || catalogViolation(value, value.module)) {
      // Bad/unmappable plan → let the Copilot answer in prose instead.
      return { kind: 'question', text: trimmed };
    }
    const renderMode = out.renderMode === 'metric' ? 'metric' : 'list';
    const metricField = renderMode === 'metric' && out.metricField ? out.metricField : null;
    return {
      kind: 'data',
      card: {
        title: (out.title || trimmed).slice(0, 120),
        module: value.module,
        renderMode,
        queryPlan: { ...value, nlSource: trimmed },
        metricConfig: { agg: metricField ? 'sum' : 'count', field: metricField },
      },
    };
  }

  // ── clarify ─────────────────────────────────────────────────────────────
  if (out.kind === 'clarify' && out.clarification) {
    return { kind: 'clarify', clarification: out.clarification };
  }

  // ── question (default) ──────────────────────────────────────────────────────
  return { kind: 'question', text: trimmed };
};

export default { routeHomeIntent };
