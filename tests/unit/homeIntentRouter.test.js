// tests/unit/homeIntentRouter.test.js
import { jest } from '@jest/globals';
import { routeHomeIntent } from '../../services/home/intentRouter.js';

// Fake Anthropic client returning a scripted forced-tool response.
const fakeClient = (input) => {
  const create = jest.fn(async () => ({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't1', name: 'route_intent', input }],
  }));
  return { messages: { create }, create };
};

describe('routeHomeIntent', () => {
  it('routes an action intent (create lead) with a label', async () => {
    const client = fakeClient({ kind: 'action', entity: 'lead', mode: 'create' });
    const out = await routeHomeIntent('create a new lead', { client });
    expect(out.kind).toBe('action');
    expect(out.entity).toBe('lead');
    expect(out.mode).toBe('create');
    expect(out.label).toMatch(/create a new lead/i);
    // forced single tool
    expect(client.create.mock.calls[0][0].tool_choice).toEqual({ type: 'tool', name: 'route_intent' });
  });

  it('routes an "open" action for channel partners with a readable label', async () => {
    const client = fakeClient({ kind: 'action', entity: 'channelPartner', mode: 'open' });
    const out = await routeHomeIntent('take me to channel partners', { client });
    expect(out).toMatchObject({ kind: 'action', entity: 'channelPartner', mode: 'open' });
    expect(out.label).toMatch(/channel partner/i);
  });

  it('compiles a valid data intent into a renderable My-View card', async () => {
    const client = fakeClient({
      kind: 'data',
      module: 'leads',
      title: 'Stale CP leads',
      renderMode: 'list',
      filters: [{ field: 'daysSinceLastCPFollowUp', op: 'gte', value: 30 }],
      sort: { field: 'daysSinceLastCPFollowUp', dir: 'desc' },
    });
    const out = await routeHomeIntent('leads with no CP follow-up in 30 days', { client });
    expect(out.kind).toBe('data');
    expect(out.card.module).toBe('leads');
    expect(out.card.renderMode).toBe('list');
    expect(out.card.queryPlan.filters[0]).toEqual({ field: 'daysSinceLastCPFollowUp', op: 'gte', value: 30 });
    expect(out.card.queryPlan.nlSource).toBe('leads with no CP follow-up in 30 days');
    expect(out.card.metricConfig).toEqual({ agg: 'count', field: null });
  });

  it('builds a metric (sum) card when renderMode=metric + metricField', async () => {
    const client = fakeClient({
      kind: 'data',
      module: 'sales',
      title: 'Revenue (90d)',
      renderMode: 'metric',
      metricField: 'salePrice',
      filters: [{ field: 'bookingDate', op: 'lastNDays', value: 90 }],
    });
    const out = await routeHomeIntent('total revenue booked in the last 90 days', { client });
    expect(out.kind).toBe('data');
    expect(out.card.renderMode).toBe('metric');
    expect(out.card.metricConfig).toEqual({ agg: 'sum', field: 'salePrice' });
  });

  it('degrades an invalid data plan (unknown field) to a question', async () => {
    const client = fakeClient({
      kind: 'data',
      module: 'leads',
      renderMode: 'list',
      filters: [{ field: 'totallyMadeUpField', op: 'is', value: 'x' }],
    });
    const out = await routeHomeIntent('leads with a made up field', { client });
    expect(out.kind).toBe('question');
    expect(out.text).toBe('leads with a made up field');
  });

  it('passes through a question intent', async () => {
    const client = fakeClient({ kind: 'question' });
    const out = await routeHomeIntent('how is business this month?', { client });
    expect(out).toEqual({ kind: 'question', text: 'how is business this month?' });
  });

  it('returns a clarify intent with the clarification text', async () => {
    const client = fakeClient({ kind: 'clarify', clarification: 'Which project did you mean?' });
    const out = await routeHomeIntent('show me that thing', { client });
    expect(out).toEqual({ kind: 'clarify', clarification: 'Which project did you mean?' });
  });

  it('clarifies on empty input without calling the model', async () => {
    const client = fakeClient({ kind: 'question' });
    const out = await routeHomeIntent('   ', { client });
    expect(out.kind).toBe('clarify');
    expect(client.create).not.toHaveBeenCalled();
  });

  it('clarifies (no throw) when the model returns no tool call', async () => {
    const client = { messages: { create: jest.fn(async () => ({ content: [{ type: 'text', text: 'hmm' }] })) } };
    const out = await routeHomeIntent('???', { client });
    expect(out.kind).toBe('clarify');
  });
});
