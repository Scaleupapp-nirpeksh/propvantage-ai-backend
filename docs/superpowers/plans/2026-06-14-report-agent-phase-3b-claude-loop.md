# Report Agent — Phase 3b: Claude Tool-Use Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the three Phase-3a tools into a Claude tool-use loop that turns a conversation into a validated `ReportDefinition`, persist the conversation + working definition as a session, and expose it via `POST /reports/agent/message` (+ a GET to resume). This is the first Anthropic tool-use loop in the codebase.

**Architecture:** `runAgentTurn` is a pure-of-I/O loop that takes an injected Anthropic `client` and the tool implementations (dependency injection) — so it's fully unit-testable with a scripted fake client (no live API, no SDK module-mock). Claude is given 3 read-only tools (`list_projects`, `get_metric_catalog`, `get_data_preview`) for grounding and one "commit" tool `update_report({ definition, reply })`; when it calls `update_report`, the server validates the definition (reusing `validateTemplatePayload`) and, if invalid, returns the errors as a tool_result so Claude self-corrects (re-prompt). Numbers-integrity is structural: the definition only references block *types*; real numbers are computed server-side at preview/generate, never authored by the model. The controller builds `ctx` strictly from `req.user`/`req.accessibleProjectIds` (never from model-emitted args).

**Tech Stack:** Node ESM, `@anthropic-ai/sdk` ^0.78.0 (`anthropic.messages.create` with `tools` + `tool_use`/`tool_result` content blocks), model `process.env.REPORT_AGENT_MODEL || 'claude-sonnet-4-6'`. Jest 29 DB-free unit tests under `tests/unit/`.

**Repo:** `propvantage-ai-backend`, branch `feature/report-agent`.

**Carried from the Phase-3a review:** add an `ObjectId.isValid` guard in `tools.js` (the tools are now agent-reachable) + an empty-`accessibleProjectIds` test case; `ctx` is built only from `req`.

**Anthropic response shape (SDK 0.78):** `resp.content` is an array of blocks; a tool request is `{ type:'tool_use', id, name, input }`; text is `{ type:'text', text }`; `resp.stop_reason === 'tool_use'` when tools are requested. To continue, append `{ role:'assistant', content: resp.content }` then `{ role:'user', content: [{ type:'tool_result', tool_use_id, content }] }`.

---

## File Structure

- **Create** `models/reportAgentSession.js` — persists `{ organization, createdBy, templateId?, definition, transcript[], status }`.
- **Create** `services/reports/agent/agentService.js` — `AGENT_TOOLS`, `SYSTEM_PROMPT`, `normalizeDefinition`, `runAgentTurn` (DI loop).
- **Modify** `services/reports/agent/tools.js` — `ObjectId.isValid` guard.
- **Create** `controllers/reportAgentController.js` — `postAgentMessage`, `getAgentSession`.
- **Modify** `routes/reportRoutes.js` — `POST /agent/message`, `GET /agent/sessions/:id`.
- **Create** `tests/unit/reportAgentSession.test.js`, `tests/unit/agentService.test.js`; **modify** `tests/unit/agentTools.test.js` (the `[]` case).

Testing convention: model + `runAgentTurn` + tools get DB-free unit tests; the thin Express controller is not unit-tested (covered in the UI/e2e phase).

---

## Task 1: `reportAgentSession` model

**Files:** Create `models/reportAgentSession.js`; Test `tests/unit/reportAgentSession.test.js`

- [ ] **Step 1: Failing test**

```js
// tests/unit/reportAgentSession.test.js
import ReportAgentSession from '../../models/reportAgentSession.js';

describe('ReportAgentSession', () => {
  it('defaults status to active and transcript/definition to sane empties', () => {
    const s = new ReportAgentSession({ organization: '000000000000000000000000', createdBy: '000000000000000000000000' });
    expect(s.status).toBe('active');
    expect(Array.isArray(s.transcript)).toBe(true);
    expect(s.transcript).toHaveLength(0);
  });
  it('accepts a working definition and transcript turns', () => {
    const s = new ReportAgentSession({
      organization: '000000000000000000000000', createdBy: '000000000000000000000000',
      definition: { name: 'R', scope: { mode: 'portfolio' }, blocks: [] },
      transcript: [{ role: 'user', content: 'hi' }],
    });
    expect(s.definition.name).toBe('R');
    expect(s.transcript[0].role).toBe('user');
  });
});
```

- [ ] **Step 2: Run; verify FAIL** — `node --experimental-vm-modules node_modules/jest/bin/jest.js --config jest.unit.config.mjs tests/unit/reportAgentSession.test.js`

- [ ] **Step 3: Implement the model**

```js
// File: models/reportAgentSession.js
// Description: A report-agent conversation: the running transcript plus the working
// ReportDefinition the agent is composing. Created/updated by the /reports/agent/* routes.
import mongoose from 'mongoose';

const turnSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
  },
  { _id: false }
);

const reportAgentSessionSchema = new mongoose.Schema(
  {
    organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportTemplate', default: null },
    // The working report definition the agent is editing (same shape as a template's editable fields).
    definition: { type: mongoose.Schema.Types.Mixed, default: () => ({ name: '', scope: { mode: 'portfolio' }, theme: { preset: 'clean' }, blocks: [] }) },
    transcript: { type: [turnSchema], default: [] },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

const ReportAgentSession = mongoose.models.ReportAgentSession
  || mongoose.model('ReportAgentSession', reportAgentSessionSchema);

export default ReportAgentSession;
```

- [ ] **Step 4: Run; verify PASS.**
- [ ] **Step 5: Commit** — `git add models/reportAgentSession.js tests/unit/reportAgentSession.test.js && git commit -m "feat(reports): reportAgentSession model (transcript + working definition)"`

---

## Task 2: `tools.js` ObjectId guard + empty-access test (3a review follow-up)

**Files:** Modify `services/reports/agent/tools.js`; Modify `tests/unit/agentTools.test.js`

- [ ] **Step 1: Add the failing test** (append to `tests/unit/agentTools.test.js`'s `describe`):

```js
  it('listProjects with empty access returns no projects (never "all")', async () => {
    find.mockClear();
    await listProjects({ organization: 'org1', accessibleProjectIds: [] });
    expect(find.mock.calls[0][0]._id).toEqual({ $in: [] });
  });
  it('listProjects ignores malformed ids without throwing', async () => {
    find.mockClear();
    await listProjects({ organization: 'org1', accessibleProjectIds: ['not-an-id', 'aaaaaaaaaaaaaaaaaaaaaaaa'] });
    expect(find.mock.calls[0][0]._id.$in).toHaveLength(1); // only the valid id survives
  });
```

- [ ] **Step 2: Run; verify the malformed-id test FAILS** (current code would throw `BSONError`).

- [ ] **Step 3: Guard the filter.** In `services/reports/agent/tools.js`, change `projectAccessFilter` to drop malformed ids:

```js
const projectAccessFilter = (accessibleProjectIds) => {
  if (accessibleProjectIds === null || accessibleProjectIds === undefined) return {};
  const ids = accessibleProjectIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  return { _id: { $in: ids } };
};
```

(An all-empty/all-invalid set now yields `{_id:{$in:[]}}` = none — still never "all".)

- [ ] **Step 4: Run; verify PASS** (`tests/unit/agentTools.test.js` all green).
- [ ] **Step 5: Commit** — `git add services/reports/agent/tools.js tests/unit/agentTools.test.js && git commit -m "fix(reports): guard agent tool project ids against malformed input"`

---

## Task 3: The agent service (tool-use loop)

**Files:** Create `services/reports/agent/agentService.js`; Test `tests/unit/agentService.test.js`

- [ ] **Step 1: Failing test (scripted fake client via DI)**

```js
// tests/unit/agentService.test.js
import { runAgentTurn, normalizeDefinition } from '../../services/reports/agent/agentService.js';

const ctx = { organization: 'org1', accessibleProjectIds: null, userPermissions: ['analytics:advanced'], isOwner: true };

// A fake Anthropic client whose messages.create returns a scripted queue of responses.
const fakeClient = (responses) => {
  const queue = [...responses];
  const create = jest.fn(async () => queue.shift());
  return { messages: { create }, create };
};
const tools = {
  listProjects: jest.fn(async () => [{ id: 'p1', name: 'Skyline', status: 'launched' }]),
  getMetricCatalog: jest.fn(() => [{ type: 'kpi.revenue' }]),
  getDataPreview: jest.fn(async () => [{ type: 'kpi.revenue', data: { value: 100, unit: 'currency' } }]),
};

describe('runAgentTurn', () => {
  it('runs read-only tools, then commits a valid definition via update_report', async () => {
    const client = fakeClient([
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 't1', name: 'get_data_preview', input: { scope: { mode: 'portfolio' }, metricIds: ['kpi.revenue'] } },
      ] },
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 't2', name: 'update_report', input: {
          definition: { name: 'Q2', scope: { mode: 'portfolio' }, blocks: [{ type: 'kpi.revenue' }] },
          reply: 'Added total sales value.' } },
      ] },
    ]);
    const out = await runAgentTurn(
      { definition: { name: '', scope: { mode: 'portfolio' }, blocks: [] }, transcript: [], userMessage: 'show revenue' },
      ctx, { client, tools, model: 'm' },
    );
    expect(tools.getDataPreview).toHaveBeenCalledWith({ scope: { mode: 'portfolio' }, metricIds: ['kpi.revenue'] }, ctx);
    expect(out.reply).toBe('Added total sales value.');
    expect(out.definition.name).toBe('Q2');
    // blocks normalized with id + order
    expect(out.definition.blocks[0]).toMatchObject({ type: 'kpi.revenue', order: 0 });
    expect(typeof out.definition.blocks[0].id).toBe('string');
  });

  it('re-prompts when update_report has an invalid (unknown block type) definition', async () => {
    const client = fakeClient([
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'b1', name: 'update_report', input: {
          definition: { name: 'R', scope: { mode: 'portfolio' }, blocks: [{ type: 'nope.block' }] }, reply: 'x' } },
      ] },
      { stop_reason: 'tool_use', content: [
        { type: 'tool_use', id: 'b2', name: 'update_report', input: {
          definition: { name: 'R', scope: { mode: 'portfolio' }, blocks: [{ type: 'kpi.revenue' }] }, reply: 'fixed' } },
      ] },
    ]);
    const out = await runAgentTurn(
      { definition: { name: 'R', scope: { mode: 'portfolio' }, blocks: [] }, transcript: [], userMessage: 'add a block' },
      ctx, { client, tools, model: 'm' },
    );
    expect(client.create).toHaveBeenCalledTimes(2);       // it had to retry
    expect(out.definition.blocks[0].type).toBe('kpi.revenue'); // the valid one stuck
    expect(out.reply).toBe('fixed');
    // the first (failed) round fed an error tool_result back
    const secondCallMessages = client.create.mock.calls[1][0].messages;
    const lastUser = secondCallMessages[secondCallMessages.length - 1];
    expect(JSON.stringify(lastUser)).toMatch(/Validation/);
  });

  it('returns the model text and leaves the definition unchanged when no tool is called', async () => {
    const client = fakeClient([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Which project?' }] }]);
    const def = { name: 'R', scope: { mode: 'portfolio' }, blocks: [] };
    const out = await runAgentTurn({ definition: def, transcript: [], userMessage: 'hi' }, ctx, { client, tools, model: 'm' });
    expect(out.reply).toBe('Which project?');
    expect(out.definition).toEqual(def);
  });
});

describe('normalizeDefinition', () => {
  it('fills block id + order and defaults config', () => {
    const d = normalizeDefinition({ name: 'R', scope: { mode: 'portfolio' }, blocks: [{ type: 'kpi.revenue' }, { type: 'kpi.collections', title: 'C' }] });
    expect(d.blocks[0]).toMatchObject({ type: 'kpi.revenue', order: 0, config: {} });
    expect(d.blocks[1]).toMatchObject({ type: 'kpi.collections', title: 'C', order: 1 });
    expect(typeof d.blocks[0].id).toBe('string');
  });
});
```

- [ ] **Step 2: Run; verify FAIL** — module not found.

- [ ] **Step 3: Implement the agent service**

```js
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

  for (let i = 0; i < maxIterations; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const resp = await client.messages.create({ model, max_tokens: 1500, system: SYSTEM_PROMPT, tools: AGENT_TOOLS, messages });
    const blocks = Array.isArray(resp?.content) ? resp.content : [];
    const toolUses = blocks.filter((b) => b.type === 'tool_use');
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

    if (!toolUses.length) { reply = text || reply; break; } // plain message; done

    messages.push({ role: 'assistant', content: blocks });
    const toolResults = [];
    for (const tu of toolUses) {
      if (tu.name === 'update_report') {
        const def = tu.input?.definition || {};
        const { valid, errors } = validateTemplatePayload(def, { partial: false });
        if (valid) {
          resultDefinition = normalizeDefinition(def);
          reply = tu.input?.reply || reply;
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Saved.' });
        } else {
          toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: `Validation failed: ${errors.join('; ')}` });
        }
      } else {
        let out;
        try { out = await dispatchReadOnly(tu.name, tu.input, ctx, tools); } catch (err) { out = { error: err.message }; }
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 8000) });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  const newTranscript = [...transcript, { role: 'user', content: userMessage }, { role: 'assistant', content: reply }];
  return { definition: resultDefinition, reply, transcript: newTranscript };
};

export default { runAgentTurn, normalizeDefinition, AGENT_TOOLS, SYSTEM_PROMPT };
```

- [ ] **Step 4: Run; verify PASS** (`tests/unit/agentService.test.js`).
- [ ] **Step 5: Commit** — `git add services/reports/agent/agentService.js tests/unit/agentService.test.js && git commit -m "feat(reports): Claude tool-use loop (runAgentTurn) with validate-and-re-prompt"`

---

## Task 4: Endpoints — `/reports/agent/message` + resume

**Files:** Create `controllers/reportAgentController.js`; Modify `routes/reportRoutes.js`. Thin glue; no unit test (covered by UI/e2e phase).

- [ ] **Step 1: Controller**

```js
// File: controllers/reportAgentController.js
import asyncHandler from 'express-async-handler';
import Anthropic from '@anthropic-ai/sdk';
import ReportAgentSession from '../models/reportAgentSession.js';
import { runAgentTurn } from '../services/reports/agent/agentService.js';
import * as tools from '../services/reports/agent/tools.js';
import { resolveReportData } from '../services/reports/snapshotService.js';

const MODEL = process.env.REPORT_AGENT_MODEL || 'claude-sonnet-4-6';
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

// ctx is built ONLY from the authenticated request — never from model-emitted tool args.
const ctxFromReq = (req) => ({
  organization: req.user.organization,
  accessibleProjectIds: req.accessibleProjectIds,
  userPermissions: req.userPermissions || [],
  isOwner: req.isOwner || false,
});

/**
 * @desc  Send a message to the report agent; returns the updated definition + a live preview.
 * @route POST /api/reports/agent/message   body: { sessionId?, message }
 * @access Private (reports:manage)
 */
export const postAgentMessage = asyncHandler(async (req, res) => {
  if (!client) { res.status(503); throw new Error('AI is not configured.'); }
  const { sessionId, message } = req.body || {};
  if (!message || !String(message).trim()) { res.status(400); throw new Error('A message is required.'); }

  let session = sessionId
    ? await ReportAgentSession.findOne({ _id: sessionId, organization: req.user.organization })
    : null;
  if (sessionId && !session) { res.status(404); throw new Error('Session not found.'); }
  if (!session) {
    session = await ReportAgentSession.create({ organization: req.user.organization, createdBy: req.user._id });
  }

  const ctx = ctxFromReq(req);
  const { definition, reply, transcript } = await runAgentTurn(
    { definition: session.definition, transcript: session.transcript, userMessage: String(message) },
    ctx,
    { client, tools, model: MODEL },
  );

  session.definition = definition;
  session.transcript = transcript;
  await session.save();

  // Live preview of the (possibly updated) definition so the canvas can render real data.
  let previewBlocks = [];
  try {
    const resolved = await resolveReportData({ ...definition, organization: req.user.organization }, { accessibleProjectIds: req.accessibleProjectIds });
    previewBlocks = resolved.blocks;
  } catch (err) { previewBlocks = []; } // e.g. scope not yet chosen / inaccessible — canvas shows empty

  res.json({ success: true, data: { sessionId: session._id, reply, definition, previewBlocks } });
});

/**
 * @desc  Resume a session.
 * @route GET /api/reports/agent/sessions/:id
 * @access Private (reports:manage)
 */
export const getAgentSession = asyncHandler(async (req, res) => {
  const session = await ReportAgentSession.findOne({ _id: req.params.id, organization: req.user.organization });
  if (!session) { res.status(404); throw new Error('Session not found.'); }
  res.json({ success: true, data: { sessionId: session._id, definition: session.definition, transcript: session.transcript } });
});
```

- [ ] **Step 2: Routes.** In `routes/reportRoutes.js`, add the import + two routes (after the `/preview` route from Phase 3a):

```js
import { postAgentMessage, getAgentSession } from '../controllers/reportAgentController.js';
// ...
router.post('/agent/message', hasPermission(PERMISSIONS.REPORTS.MANAGE), postAgentMessage);
router.get('/agent/sessions/:id', hasPermission(PERMISSIONS.REPORTS.MANAGE), getAgentSession);
```

- [ ] **Step 3: Verify boot + full suite** — `node --check controllers/reportAgentController.js && node --check routes/reportRoutes.js` then `npm run test:unit` (all green incl. Phases 1–3a + the new agentService/session/tools tests).

- [ ] **Step 4: Commit** — `git add controllers/reportAgentController.js routes/reportRoutes.js && git commit -m "feat(reports): /reports/agent/message + session resume endpoints"`

---

## Self-Review (done while writing)

- **Spec coverage:** Completes spec §8 — the Claude tool-use loop, the 4 tools (3 read-only + update_report), structured `ReportDefinition` output validated via `validateTemplatePayload` with **re-prompt on invalid**, the `/reports/agent/message` (+ resume) endpoints, session persistence (`reportAgentSession`), and the numbers-integrity guarantee (model emits block types only; figures resolved server-side; `previewBlocks` come from `resolveReportData`). Carries the 3a review follow-ups (ObjectId guard, ctx-from-req).
- **Placeholder scan:** none — full code + exact commands.
- **Type consistency:** `runAgentTurn` returns `{ definition, reply, transcript }`; controller persists those and returns `{ sessionId, reply, definition, previewBlocks }`; `normalizeDefinition` block shape `{ id, type, title, config, order }` matches `blockSchema`; tools dispatched with the 3a signatures (`listProjects(ctx)`, `getMetricCatalog(ctx)`, `getDataPreview(input, ctx)`); `ctx` shape consistent across controller + tools.
- **Security:** `ctx` is built only from `req` (org + access server-derived); the preview reuses `resolveReportData` (scope can only narrow; throws→empty preview, never a crash or org-wide leak); routes gated `REPORTS.MANAGE`.
- **Testability:** `runAgentTurn` uses DI (injected `client` + `tools`), so the loop, the re-prompt path, and the no-tool path are unit-tested with a scripted fake client — no live API, no SDK module mock.
