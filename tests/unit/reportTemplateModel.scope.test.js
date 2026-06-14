// tests/unit/reportTemplateModel.scope.test.js
// Mongoose instantiation needs no DB connection; defaults apply on `new Model()`.
import ReportTemplate, { SCOPE_MODES } from '../../models/reportTemplateModel.js';

describe('ReportTemplate.scope.mode', () => {
  it('exports the three scope modes', () => {
    expect(SCOPE_MODES).toEqual(['portfolio', 'project', 'compare']);
  });

  it('defaults scope.mode to "portfolio"', () => {
    const doc = new ReportTemplate({ organization: '000000000000000000000000', name: 'T' });
    expect(doc.scope.mode).toBe('portfolio');
  });

  it('accepts an explicit valid mode', () => {
    const doc = new ReportTemplate({
      organization: '000000000000000000000000', name: 'T',
      scope: { mode: 'compare', projects: [] },
    });
    expect(doc.scope.mode).toBe('compare');
  });
});
