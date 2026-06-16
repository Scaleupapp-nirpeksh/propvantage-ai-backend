// tests/unit/workspaceNlToQueryPlan.test.js
import { jest } from '@jest/globals';
import { nlToQueryPlan } from '../../services/workspace/nlToQueryPlan.js';

const viewerCtx = { organization: 'org1', accessibleProjectIds: null, userPermissions: [], isOwner: true };

// Fake Anthropic client: messages.create returns a scripted queue (matches agentService.test.js style).
const fakeClient = (responses) => {
  const queue = [...responses];
  const create = jest.fn(async () => queue.shift());
  return { messages: { create }, create };
};

// A response shaped like a forced single-tool call to emit_query_plan.
const planResponse = (plan) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 'qp1', name: 'emit_query_plan', input: plan }],
});

describe('nlToQueryPlan', () => {
  it('compiles a valid leads sentence into a validated plan with nlSource set', async () => {
    const text = "leads where the channel partner hasn't followed up in 15 days";
    const client = fakeClient([
      planResponse({
        module: 'leads',
        logic: 'AND',
        filters: [{ field: 'daysSinceLastCPFollowUp', op: 'gte', value: 15 }],
        sort: { field: 'daysSinceLastCPFollowUp', dir: 'desc' },
        limit: 50,
      }),
    ]);

    const { plan, clarification } = await nlToQueryPlan(text, { module: 'leads', viewerCtx, client });

    expect(clarification).toBeNull();
    expect(plan).not.toBeNull();
    expect(plan.module).toBe('leads');
    expect(plan.filters[0]).toEqual({ field: 'daysSinceLastCPFollowUp', op: 'gte', value: 15 });
    expect(plan.sort).toEqual({ field: 'daysSinceLastCPFollowUp', dir: 'desc' });
    expect(plan.nlSource).toBe(text);
    // forced tool output: tool_choice names the single tool
    expect(client.create).toHaveBeenCalledTimes(1);
    const callArg = client.create.mock.calls[0][0];
    expect(callArg.tool_choice).toEqual({ type: 'tool', name: 'emit_query_plan' });
    expect(callArg.tools[0].name).toBe('emit_query_plan');
  });

  it('returns a clarification (not a throw) when the model references an unknown field', async () => {
    const client = fakeClient([
      planResponse({
        module: 'leads',
        logic: 'AND',
        filters: [{ field: 'totallyMadeUpField', op: 'is', value: 'x' }],
        sort: null,
        limit: 50,
      }),
    ]);

    const result = await nlToQueryPlan('leads with a made up field', { module: 'leads', viewerCtx, client });

    expect(result.plan).toBeNull();
    expect(typeof result.clarification).toBe('string');
    expect(result.clarification.length).toBeGreaterThan(0);
    expect(result.clarification).toMatch(/totallyMadeUpField/);
  });

  it('returns a clarification when the operator is not allowed for the field', async () => {
    // `contains` is a string-only operator; a numeric/date field like daysSinceLastCPFollowUp
    // does not list it, so the catalog check must reject the plan rather than run it.
    const client = fakeClient([
      planResponse({
        module: 'leads',
        logic: 'AND',
        filters: [{ field: 'daysSinceLastCPFollowUp', op: 'contains', value: 15 }],
        sort: null,
        limit: 50,
      }),
    ]);

    const result = await nlToQueryPlan('leads cp follow up contains 15', { module: 'leads', viewerCtx, client });

    expect(result.plan).toBeNull();
    expect(typeof result.clarification).toBe('string');
    expect(result.clarification).toMatch(/contains/);
  });
});
