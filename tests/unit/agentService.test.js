// tests/unit/agentService.test.js
import { jest } from '@jest/globals';
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

  it('Exhaustion fallback: loop runs to cap when model always calls read-only tool', async () => {
    const MAX_ITERATIONS = 6; // matches the value in agentService.js
    // Build a client whose create always returns a read-only tool_use (never commits).
    const infiniteResponse = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'get_metric_catalog', input: {} }] };
    const create = jest.fn(async () => ({ ...infiniteResponse, content: [...infiniteResponse.content] }));
    const infiniteClient = { messages: { create }, create };

    const initialDef = { name: 'R', scope: { mode: 'portfolio' }, blocks: [] };
    const out = await runAgentTurn(
      { definition: initialDef, transcript: [], userMessage: 'show everything' },
      ctx,
      { client: infiniteClient, tools, model: 'm', maxIterations: MAX_ITERATIONS },
    );

    expect(out.reply).toBe("I wasn't able to complete that in one step — could you rephrase or add a bit more detail?");
    expect(out.definition).toEqual(initialDef);
    expect(create).toHaveBeenCalledTimes(MAX_ITERATIONS);
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
