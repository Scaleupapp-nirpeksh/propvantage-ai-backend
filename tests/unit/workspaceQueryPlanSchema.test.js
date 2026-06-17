// tests/unit/workspaceQueryPlanSchema.test.js
// Validates the canonical QueryPlan contract shared by builder, NL, and engine.
import { validateQueryPlan, MODULES } from '../../services/workspace/queryPlanSchema.js';
import { OPERATORS } from '../../services/workspace/operators.js';

const basePlan = (over = {}) => ({
  module: 'leads',
  logic: 'AND',
  filters: [{ field: 'status', op: 'is', value: 'New' }],
  sort: { field: 'createdAt', dir: 'desc' },
  limit: 50,
  nlSource: null,
  ...over,
});

describe('validateQueryPlan', () => {
  it('accepts a minimal valid leads plan and returns the coerced value', () => {
    const { error, value } = validateQueryPlan(basePlan());
    expect(error).toBeUndefined();
    expect(value.module).toBe('leads');
    expect(value.logic).toBe('AND');
    expect(value.filters[0]).toEqual({ field: 'status', op: 'is', value: 'New' });
  });

  it('exposes the exact module enum', () => {
    expect(MODULES).toEqual(['leads', 'sales', 'payments', 'tasks', 'channelPartners', 'projects']);
  });

  it('exposes the exact operator enum', () => {
    expect(Object.values(OPERATORS)).toEqual([
      'is', 'in', 'notIn', 'gt', 'lt', 'gte', 'lte',
      'between', 'lastNDays', 'isEmpty', 'isNotEmpty', 'contains',
    ]);
  });

  it('defaults limit to 50 when omitted', () => {
    const { value } = validateQueryPlan(basePlan({ limit: undefined }));
    expect(value.limit).toBe(50);
  });

  it('caps limit at 200', () => {
    const { error } = validateQueryPlan(basePlan({ limit: 500 }));
    expect(error).toBeDefined();
    expect(error.message).toMatch(/limit/);
  });

  it('rejects an unknown module', () => {
    const { error } = validateQueryPlan(basePlan({ module: 'invoices' }));
    expect(error).toBeDefined();
    expect(error.message).toMatch(/module/);
  });

  it('rejects an unknown operator', () => {
    const { error } = validateQueryPlan(basePlan({ filters: [{ field: 'status', op: 'like', value: 'x' }] }));
    expect(error).toBeDefined();
    expect(error.message).toMatch(/op/);
  });

  it('rejects a logic value other than AND (v1 is AND-only)', () => {
    const { error } = validateQueryPlan(basePlan({ logic: 'OR' }));
    expect(error).toBeDefined();
  });

  it('allows an empty filter array (unfiltered = all in-scope records)', () => {
    const { value, error } = validateQueryPlan(basePlan({ filters: [] }));
    expect(error).toBeUndefined();
    expect(value.filters).toEqual([]);
  });

  it('defaults filters to [] when omitted', () => {
    const { value, error } = validateQueryPlan({ module: 'leads' });
    expect(error).toBeUndefined();
    expect(value.filters).toEqual([]);
  });

  it('allows sort to be null', () => {
    const { error } = validateQueryPlan(basePlan({ sort: null }));
    expect(error).toBeUndefined();
  });

  it('rejects a sort dir other than asc/desc', () => {
    const { error } = validateQueryPlan(basePlan({ sort: { field: 'createdAt', dir: 'up' } }));
    expect(error).toBeDefined();
  });

  it('strips unknown top-level keys', () => {
    const { value } = validateQueryPlan(basePlan({ evil: 'rm -rf' }));
    expect(value.evil).toBeUndefined();
  });
});
