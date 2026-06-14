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
