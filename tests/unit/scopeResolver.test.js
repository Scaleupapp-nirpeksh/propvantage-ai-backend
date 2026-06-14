// tests/unit/scopeResolver.test.js
import { resolveReportScope } from '../../services/reports/scopeResolver.js';

// Two real accessible ids + one the user cannot access.
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const X = 'cccccccccccccccccccccccc';

describe('resolveReportScope', () => {
  it('portfolio + owner (null access) → all projects (null)', () => {
    expect(resolveReportScope({ mode: 'portfolio' }, null)).toEqual({ mode: 'portfolio', projectIds: null });
  });

  it('portfolio + user → their full accessible set', () => {
    expect(resolveReportScope({ mode: 'portfolio' }, [A, B])).toEqual({ mode: 'portfolio', projectIds: [A, B] });
  });

  it('portfolio + user with NO access → throws (never returns [] = "all")', () => {
    expect(() => resolveReportScope({ mode: 'portfolio' }, [])).toThrow(/no accessible projects/i);
  });

  it('project + user → intersection of selection and access', () => {
    expect(resolveReportScope({ mode: 'project', projects: [A, X] }, [A, B]))
      .toEqual({ mode: 'project', projectIds: [A] });
  });

  it('project + owner → the selection as-is', () => {
    expect(resolveReportScope({ mode: 'project', projects: [A, X] }, null))
      .toEqual({ mode: 'project', projectIds: [A, X] });
  });

  it('compare → intersection (same access rule)', () => {
    expect(resolveReportScope({ mode: 'compare', projects: [A, B] }, [A, B]))
      .toEqual({ mode: 'compare', projectIds: [A, B] });
  });

  it('selection with no accessible match → throws', () => {
    expect(() => resolveReportScope({ mode: 'project', projects: [X] }, [A, B]))
      .toThrow(/none of the selected projects/i);
  });

  it('project/compare mode without a selection → throws', () => {
    expect(() => resolveReportScope({ mode: 'project', projects: [] }, [A]))
      .toThrow(/requires scope.projects/i);
  });

  it('back-compat: no mode + projects chosen → treated as project scope', () => {
    expect(resolveReportScope({ projects: [A] }, [A, B])).toEqual({ mode: 'project', projectIds: [A] });
  });

  it('back-compat: no mode + no projects → portfolio', () => {
    expect(resolveReportScope({}, null)).toEqual({ mode: 'portfolio', projectIds: null });
  });
});
