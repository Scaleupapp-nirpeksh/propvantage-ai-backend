// File: tests/unit/templateValidation.test.js
import { validateTemplatePayload } from '../../services/reports/templateValidation.js';

const fullValid = {
  name: 'Monthly Leadership Report',
  blocks: [
    { id: 'b1', type: 'kpi.revenue', config: {} },
    { id: 'b2', type: 'layout.hero', config: { title: 'Q2' } },
  ],
  theme: { preset: 'clean' },
  access: { gate: 'email' },
  delivery: { mode: 'review_then_send' },
  schedule: { frequency: 'monthly' },
  scope: { period: { preset: 'mtd' } },
};

describe('validateTemplatePayload', () => {
  it('accepts a full valid payload', () => {
    expect(validateTemplatePayload(fullValid)).toEqual({ valid: true, errors: [] });
  });

  it('requires name on create (non-partial)', () => {
    const r = validateTemplatePayload({ blocks: [] });
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('name is required');
  });

  it('allows a partial update without name', () => {
    expect(validateTemplatePayload({ theme: { preset: 'midnight' } }, { partial: true }).valid).toBe(true);
  });

  it('rejects a non-array blocks field', () => {
    const r = validateTemplatePayload({ name: 'X', blocks: 'nope' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('blocks must be an array'))).toBe(true);
  });

  it('rejects an unknown block type', () => {
    const r = validateTemplatePayload({ name: 'X', blocks: [{ id: 'b1', type: 'kpi.unknown' }] });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('kpi.unknown') && e.includes('not a known block type'))).toBe(true);
  });

  it('requires id and type on each block', () => {
    const r = validateTemplatePayload({ name: 'X', blocks: [{ config: {} }] });
    expect(r.errors).toContain('blocks[0].id is required');
    expect(r.errors).toContain('blocks[0].type is required');
  });

  it('rejects bad enum values', () => {
    const r = validateTemplatePayload({
      name: 'X',
      theme: { preset: 'neon' },
      access: { gate: 'open' },
      delivery: { mode: 'blast' },
      schedule: { frequency: 'daily' },
      scope: { period: { preset: 'forever' } },
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.startsWith('theme.preset'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('access.gate'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('delivery.mode'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('schedule.frequency'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('scope.period.preset'))).toBe(true);
  });
});
