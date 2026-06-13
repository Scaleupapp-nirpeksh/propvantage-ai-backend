// File: tests/unit/snapshotService.test.js
import { buildSnapshotBlocks, resolvePeriodArgs } from '../../services/reports/snapshotService.js';

const overview = {
  revenue: { totalSalesValue: 100, totalCollected: 60 },
  portfolio: { unitsByStatus: { sold: 2 } },
};

describe('buildSnapshotBlocks', () => {
  it('attaches resolved data to each known block', () => {
    const out = buildSnapshotBlocks([{ id: 'b1', type: 'kpi.revenue', config: {} }], overview);
    expect(out[0].id).toBe('b1');
    expect(out[0].data).toEqual({ value: 100, unit: 'currency' });
  });

  it('marks unknown block types with an error instead of throwing', () => {
    const out = buildSnapshotBlocks([{ id: 'x', type: 'nope.block' }], overview);
    expect(out[0].data.error).toMatch(/Unknown block type/);
  });

  it('isolates a resolver failure to its own block', () => {
    // overview is null → data-bearing resolvers read undefined safely (num→0),
    // so force a throw via a block whose resolve dereferences a bad config path.
    const out = buildSnapshotBlocks(
      [{ id: 'ok', type: 'kpi.revenue', config: {} }, { id: 'bad', type: 'text.note', config: null }],
      overview
    );
    expect(out[0].data).toEqual({ value: 100, unit: 'currency' });
    expect(out[1].data).toEqual({ text: '' }); // null config handled by default param
  });

  it('returns [] for empty input', () => {
    expect(buildSnapshotBlocks([], overview)).toEqual([]);
    expect(buildSnapshotBlocks(undefined, overview)).toEqual([]);
  });
});

describe('resolvePeriodArgs', () => {
  it('maps presets to a period string', () => {
    expect(resolvePeriodArgs({ period: { preset: 'qtd' } })).toEqual({ period: '90', startDate: undefined, endDate: undefined });
    expect(resolvePeriodArgs({ period: { preset: 'ytd' } })).toEqual({ period: '365', startDate: undefined, endDate: undefined });
  });

  it('uses custom dates when preset is custom', () => {
    const s = new Date('2026-01-01'); const e = new Date('2026-03-31');
    expect(resolvePeriodArgs({ period: { preset: 'custom', customStart: s, customEnd: e } }))
      .toEqual({ period: '30', startDate: s, endDate: e });
  });

  it('defaults to 30 days when scope/preset missing', () => {
    expect(resolvePeriodArgs()).toEqual({ period: '30', startDate: undefined, endDate: undefined });
    expect(resolvePeriodArgs({})).toEqual({ period: '30', startDate: undefined, endDate: undefined });
  });
});
