// tests/unit/templateValidation.scope.test.js
import { validateTemplatePayload } from '../../services/reports/templateValidation.js';

const OK_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

describe('validateTemplatePayload — scope', () => {
  it('accepts a valid scope', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { mode: 'project', projects: [OK_ID] } });
    expect(r.valid).toBe(true);
  });

  it('rejects an unknown scope.mode', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { mode: 'galaxy' } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/scope.mode/);
  });

  it('rejects scope.projects that is not an array', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { projects: 'nope' } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/scope.projects must be an array/);
  });

  it('rejects a malformed project id', () => {
    const r = validateTemplatePayload({ name: 'T', scope: { projects: ['not-an-id'] } });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/scope.projects\[0\]/);
  });
});
