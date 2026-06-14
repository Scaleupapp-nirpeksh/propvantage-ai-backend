// File: services/reports/agent/agentService.js
// The report agent's Claude tool-use loop. runAgentTurn is I/O-injected (client + tools)
// so it is fully unit-testable without the live SDK. Numbers-integrity is structural:
// the model only ever emits block *types* via update_report; real figures are computed
// server-side by resolveReportData at preview/generate time.
import { validateTemplatePayload } from '../templateValidation.js';

const MAX_ITERATIONS = 6;

export const SYSTEM_PROMPT = [
  'You are PropVantage\'s report-builder assistant. You help leadership compose a one-page',
  'report by editing a ReportDefinition (name, scope, theme, blocks).',
  'Use list_projects to see which projects the user can report on, get_metric_catalog to see',
  'the available block types, and get_data_preview to fetch REAL numbers to decide what to include',
  'and to sanity-check. NEVER invent or state specific figures yourself — only reference block',
  'TYPES; the system computes the real numbers. When you have changes to apply, call update_report',
  'with the COMPLETE updated definition and a short, plain-language reply for the user. Keep reports',
  'focused and board-level. If you need a project/period the user has not specified, ask (reply via',
  'a normal message, no tool) rather than guessing.',
].join(' ');

export const AGENT_TOOLS = [
  { name: 'list_projects', description: 'List the projects the user can scope a report to.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_metric_catalog', description: 'List the report block types the user may use.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'get_data_preview',
    description: 'Resolve real numbers for the given metric block types under a scope, to ground decisions/wording.',
    input_schema: {
      type: 'object',
      properties: {
        scope: { type: 'object', description: 'A scope object: { mode: portfolio|project|compare, projects?: string[], period?: { preset } }' },
        metricIds: { type: 'array', items: { type: 'string' }, description: 'Block types to resolve, e.g. ["kpi.revenue"].' },
      },
      required: ['metricIds'],
    },
  },
  {
    name: 'update_report',
    description: 'Apply the complete updated report definition and give the user a short reply.',
    input_schema: {
      type: 'object',
      properties: {
        definition: {
          type: 'object',
          description: 'The full ReportDefinition: { name, scope:{mode,projects?,period?}, theme:{preset}, blocks:[{type,title?,config?}] }.',
        },
        reply: { type: 'string', description: 'A short, plain-language message to the user describing what changed.' },
      },
      required: ['definition', 'reply'],
    },
  },
];

/** Ensure every block has a stable id + order + config; preserve scope/theme/name. Pure. */
export const normalizeDefinition = (def = {}) => ({
  name: def.name || '',
  scope: def.scope || { mode: 'portfolio' },
  theme: def.theme || { preset: 'clean' },
  blocks: (Array.isArray(def.blocks) ? def.blocks : []).map((b, i) => ({
    id: b.id || `${b.type}-${i}`,
    type: b.type,
    title: b.title,
    config: b.config || {},
    order: b.order ?? i,
  })),
});

const dispatchReadOnly = (name, input, ctx, tools) => {
  if (name === 'list_projects') return tools.listProjects(ctx);
  if (name === 'get_metric_catalog') return tools.getMetricCatalog(ctx);
  if (name === 'get_data_preview') return tools.getDataPreview(input || {}, ctx);
  return { error: `Unknown tool: ${name}` };
};

/**
 * Run one user turn through the tool-use loop.
 * @param {{definition, transcript, userMessage}} state
 * @param {object} ctx - { organization, accessibleProjectIds, userPermissions, isOwner }
 * @param {{client, tools, model, maxIterations?}} deps - injected Anthropic client + tool impls
 * @returns {Promise<{ definition, reply, transcript }>}
 */
export const runAgentTurn = async ({ definition, transcript = [], userMessage }, ctx, deps) => {
  const { client, tools, model, maxIterations = MAX_ITERATIONS } = deps;
  // Convert stored transcript turns to Anthropic messages, then append the new user message.
  const messages = transcript.map((t) => ({ role: t.role, content: t.content }));
  messages.push({ role: 'user', content: userMessage });

  let resultDefinition = definition;
  let reply = '';
  let hitMaxTokens = false;

  for (let i = 0; i < maxIterations; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await client.messages.create({ model, max_tokens: 4000, system: SYSTEM_PROMPT, tools: AGENT_TOOLS, messages: [...messages] });
    if (resp.stop_reason === 'max_tokens') hitMaxTokens = true;
    const blocks = Array.isArray(resp?.content) ? resp.content : [];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    if (!toolUses.length) { reply = text || reply; break; } // plain message; done

    messages.push({ role: 'assistant', content: blocks });
    const toolResults = [];
    let committed = false;
    for (const tu of toolUses) {
      if (tu.name === 'update_report') {
        // Normalize first so blocks get IDs before validateTemplatePayload checks them.
        const normalized = normalizeDefinition(tu.input?.definition || {});
        const { valid, errors } = validateTemplatePayload(normalized, { partial: false });
        if (valid) {
          resultDefinition = normalized;
          reply = tu.input?.reply || reply;
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Saved.' });
          committed = true;
        } else {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Validation failed: ${errors.join('; ')}` });
        }
      } else {
        let out;
        try { out = await dispatchReadOnly(tu.name, tu.input, ctx, tools); } catch (err) { out = { error: err.message }; }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: (() => { const s = JSON.stringify(out); return s.length > 8000 ? s.slice(0, 8000) + ' …(truncated)' : s; })() });
      }
    }
    messages.push({ role: 'user', content: toolResults });
    if (committed) break; // definition saved; done for this turn
  }

  if (!reply) {
    reply = hitMaxTokens
      ? "That got a bit long for me to finish — try narrowing the report (fewer blocks, or a single project)."
      : "I wasn't able to complete that in one step — could you rephrase or add a bit more detail?";
  }

  const newTranscript = [...transcript, { role: 'user', content: userMessage }, { role: 'assistant', content: reply }];
  return { definition: resultDefinition, reply, transcript: newTranscript };
};

export default { runAgentTurn, normalizeDefinition, AGENT_TOOLS, SYSTEM_PROMPT };
