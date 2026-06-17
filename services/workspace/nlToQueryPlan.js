// File: services/workspace/nlToQueryPlan.js
// Description: Compiles a natural-language sentence into a validated Query Plan using Claude
// (Anthropic) with forced single-tool output. Best-effort & safe: never throws on a bad/unmappable
// model result — returns { plan: null, clarification } so the caller can ask the user to refine.
// The model may ONLY reference fields/operators present in the module catalog (injected as vocab);
// the result is re-validated against the catalog AND the Joi schema before it is ever returned.
import Anthropic from '@anthropic-ai/sdk';
import { validateQueryPlan, MODULES } from './queryPlanSchema.js';
import { getCatalog, listCatalogModules } from './catalogs/index.js';

// Match the repo's model env convention (controllers/reportAgentController.js, narrativeService.js).
// NOTE: repo standard is 'claude-sonnet-4-6'; kept overridable via env for parity with other AI features.
const MODEL = process.env.WORKSPACE_NL_MODEL || 'claude-sonnet-4-6';
const MAX_TOKENS = Number(process.env.WORKSPACE_NL_MAX_TOKENS) || 1024;
const DEFAULT_LIMIT = 50;

// Lazy + quote/whitespace-tolerant client, identical to the report agent / narrative service:
// build at call time so env loaded after import is seen, and strip stray quotes the deploy's
// .env writer may wrap the key in (ANTHROPIC_API_KEY='"sk-ant-…"' would otherwise 401).
let _client = null;
const getClient = () => {
  if (_client) return _client;
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^['"]+|['"]+$/g, '');
  if (apiKey) _client = new Anthropic({ apiKey });
  return _client;
};

// Build a compact, model-facing vocabulary for one module from its catalog FieldDescriptors.
const moduleVocab = (moduleKey) => {
  let catalog;
  try {
    catalog = getCatalog(moduleKey);
  } catch {
    return null;
  }
  if (!catalog) return null;
  const fields = catalog.fields.map((f) => {
    const entry = { key: f.key, label: f.label, type: f.type, operators: f.operators };
    if (Array.isArray(f.enumValues) && f.enumValues.length) entry.enumValues = f.enumValues;
    return entry;
  });
  return { module: moduleKey, fields };
};

// Vocab for the target module, or for all registered modules when none is specified.
const buildVocab = (moduleKey) => {
  if (moduleKey) {
    const v = moduleVocab(moduleKey);
    return v ? [v] : [];
  }
  return listCatalogModules().map(moduleVocab).filter(Boolean);
};

const SYSTEM_PROMPT = [
  'You convert a user\'s plain-English request into a structured Query Plan for a real-estate CRM.',
  'You MUST call the emit_query_plan tool exactly once. Reference ONLY fields and operators that appear',
  'in the provided FIELD VOCABULARY for the relevant module — never invent a field key or use an operator',
  'a field does not list. Each filter\'s "field" must be a field "key"; each "op" must be one of that',
  'field\'s "operators". Combine conditions with logic "AND". For enum fields use one of the listed',
  'enumValues. If the request cannot be expressed with the available fields/operators, OR it is too',
  'ambiguous to map confidently, set "needsClarification" true and put a short, specific question in',
  '"clarification" instead of guessing. Keep "limit" reasonable (default 50). Use "sort": null if no',
  'ordering is implied.',
  'If the user asks for a chart, funnel, bar, line, trend, breakdown, or "by <field>", also populate the',
  '"chart" object: choose a chartType (bar/line/funnel/pie); "groupBy" MUST be a field key from the vocabulary;',
  'for sums set agg:"sum" and a numeric "metricField"; for date group-bys set timeBucket:"month". Otherwise omit "chart".',
].join(' ');

// The single forced-output tool. Its input schema mirrors the QueryPlan contract, plus a
// clarification escape hatch the model can take instead of emitting a (wrong) plan.
const emitQueryPlanTool = (vocab) => ({
  name: 'emit_query_plan',
  description: 'Emit the compiled Query Plan (or request clarification). FIELD VOCABULARY: '
    + JSON.stringify(vocab),
  input_schema: {
    type: 'object',
    properties: {
      module: { type: 'string', enum: MODULES, description: 'Target module.' },
      logic: { type: 'string', enum: ['AND'], description: 'Always "AND" in v1.' },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field: { type: 'string', description: 'A field key from the vocabulary.' },
            op: { type: 'string', description: 'An operator the field allows.' },
            value: { description: 'The comparison value (string | number | boolean | array | null).' },
          },
          required: ['field', 'op'],
        },
      },
      sort: {
        type: ['object', 'null'],
        properties: {
          field: { type: 'string' },
          dir: { type: 'string', enum: ['asc', 'desc'] },
        },
      },
      limit: { type: 'number' },
      needsClarification: { type: 'boolean', description: 'True if the request cannot be mapped confidently.' },
      clarification: { type: 'string', description: 'A short question to the user when needsClarification is true.' },
      chart: {
        type: 'object',
        description: 'Optional chart spec when the user asks for a chart/funnel/bar/line/trend/breakdown/"by <field>".',
        properties: {
          chartType: { type: 'string', enum: ['bar', 'line', 'funnel', 'pie'] },
          groupBy: { type: 'string', description: 'A field key from the vocabulary to group by.' },
          agg: { type: 'string', enum: ['count', 'sum'] },
          metricField: { type: 'string', description: 'A numeric field key (required when agg is "sum").' },
          timeBucket: { type: 'string', enum: ['month'] },
        },
      },
    },
    required: ['module', 'filters'],
  },
});

// Validate every filter/sort field exists in the catalog and each op is allowed for that field.
// Returns null on success, or a human-readable reason string on the first violation.
const catalogViolation = (plan, moduleKey) => {
  let catalog;
  try {
    catalog = getCatalog(moduleKey);
  } catch {
    return `Unknown module "${moduleKey}".`;
  }
  if (!catalog) return `Unknown module "${moduleKey}".`;
  const byKey = new Map(catalog.fields.map((f) => [f.key, f]));
  for (const f of plan.filters || []) {
    const fd = byKey.get(f.field);
    if (!fd) return `I don't have a field called "${f.field}" for ${moduleKey}.`;
    if (!fd.operators.includes(f.op)) {
      return `The "${fd.label}" field can't use "${f.op}" (allowed: ${fd.operators.join(', ')}).`;
    }
  }
  if (plan.sort && plan.sort.field) {
    if (!byKey.has(plan.sort.field)) return `I can't sort by "${plan.sort.field}" for ${moduleKey}.`;
  }
  // When a chart spec is present, its groupBy/metricField must also be catalog fields.
  if (plan.chart) {
    if (plan.chart.groupBy && !byKey.has(plan.chart.groupBy)) {
      return `I can't chart by "${plan.chart.groupBy}" for ${moduleKey}.`;
    }
    if (plan.chart.metricField && !byKey.has(plan.chart.metricField)) {
      return `I don't have a numeric field called "${plan.chart.metricField}" for ${moduleKey}.`;
    }
  }
  return null;
};

/**
 * Compile NL text into a validated Query Plan.
 * @param {string} text - the user's plain-English request.
 * @param {object} [opts]
 * @param {string} [opts.module] - target module; if omitted the model also picks the module.
 * @param {object} [opts.viewerCtx] - viewer scope (reserved; the plan is viewer-scoped at run time, not here).
 * @param {object} [opts.client] - injected Anthropic client (tests pass a fake); defaults to a real lazy client.
 * @returns {Promise<{ plan: object|null, chart?: object, clarification: string|null }>}
 */
export const nlToQueryPlan = async (text, { module, viewerCtx, client } = {}) => {
  const trimmed = (text || '').trim();
  if (!trimmed) return { plan: null, chart: undefined, clarification: 'Please type what you want to see.' };

  const anthropic = client || getClient();
  if (!anthropic) return { plan: null, chart: undefined, clarification: 'AI is not configured (ANTHROPIC_API_KEY missing).' };

  const vocab = buildVocab(module);
  if (!vocab.length) return { plan: null, chart: undefined, clarification: `I don't recognize the module "${module}".` };

  const tool = emitQueryPlanTool(vocab);

  let resp;
  try {
    resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_query_plan' }, // force the single structured output
      messages: [{ role: 'user', content: trimmed }],
    });
  } catch (err) {
    return { plan: null, clarification: `I couldn't reach the AI service (${err.message}). Try the builder.` };
  }

  const blocks = Array.isArray(resp?.content) ? resp.content : [];
  const toolUse = blocks.find((b) => b.type === 'tool_use' && b.name === 'emit_query_plan');
  if (!toolUse || !toolUse.input || typeof toolUse.input !== 'object') {
    const text2 = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    return { plan: null, clarification: text2 || "I couldn't turn that into a filter. Could you rephrase?" };
  }

  const out = toolUse.input;
  if (out.needsClarification) {
    return { plan: null, chart: undefined, clarification: out.clarification || 'Could you add a bit more detail?' };
  }

  // Assemble a candidate plan in the canonical shape; the module is the requested one or the model's choice.
  const candidate = {
    module: module || out.module,
    logic: 'AND',
    filters: Array.isArray(out.filters) ? out.filters : [],
    sort: out.sort && out.sort.field ? { field: out.sort.field, dir: out.sort.dir === 'asc' ? 'asc' : 'desc' } : null,
    limit: Number.isFinite(out.limit) ? out.limit : DEFAULT_LIMIT,
    nlSource: trimmed,
  };

  // An optional chart spec the model emitted (travels alongside the plan, not through Joi).
  const chart = out.chart && typeof out.chart === 'object' && out.chart.groupBy ? out.chart : undefined;

  // 1) Shape/whitelist validation via the shared Joi schema.
  const { value, error } = validateQueryPlan(candidate);
  if (error) {
    return { plan: null, chart: undefined, clarification: "I couldn't build a valid filter from that — try the builder, or rephrase." };
  }
  // 2) Catalog validation: every field/op (and any chart group-by/measure) is allowed.
  const violation = catalogViolation({ ...value, chart }, value.module);
  if (violation) return { plan: null, chart: undefined, clarification: violation };

  return { plan: { ...value, nlSource: trimmed }, chart, clarification: null };
};

export default { nlToQueryPlan };
