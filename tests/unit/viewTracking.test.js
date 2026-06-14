import { classifyViewer, computeInstanceStats } from '../../services/reports/viewTracking.js';

describe('classifyViewer', () => {
  it('flags a known recipient as matched (case-insensitive)', () => {
    expect(classifyViewer('Boss@Corp.com', ['boss@corp.com', 'cfo@corp.com']))
      .toEqual({ matchedRecipient: true, isForwarded: false });
  });
  it('flags an unknown email as forwarded', () => {
    expect(classifyViewer('stranger@x.com', ['boss@corp.com']))
      .toEqual({ matchedRecipient: false, isForwarded: true });
  });
  it('treats empty recipient list as all-forwarded', () => {
    expect(classifyViewer('a@b.com', [])).toEqual({ matchedRecipient: false, isForwarded: true });
    expect(classifyViewer('a@b.com', undefined)).toEqual({ matchedRecipient: false, isForwarded: true });
  });
});

describe('computeInstanceStats', () => {
  it('rolls up unique viewers, total views, matched/forwarded, and first/last open', () => {
    const d1 = new Date('2026-06-01T10:00:00Z');
    const d2 = new Date('2026-06-03T12:00:00Z');
    const d3 = new Date('2026-06-02T09:00:00Z');
    const views = [
      { email: 'boss@corp.com', matchedRecipient: true, isForwarded: false, viewCount: 3, firstViewedAt: d1, lastViewedAt: d2 },
      { email: 'x@y.com', matchedRecipient: false, isForwarded: true, viewCount: 1, firstViewedAt: d3, lastViewedAt: d3 },
    ];
    expect(computeInstanceStats(views)).toEqual({
      uniqueViewers: 2,
      totalViews: 4,
      recipientsOpened: 1,
      forwardedOpens: 1,
      firstOpenAt: d1,
      lastOpenAt: d2,
    });
  });
  it('returns zeroed stats for no views', () => {
    expect(computeInstanceStats([])).toEqual({
      uniqueViewers: 0, totalViews: 0, recipientsOpened: 0, forwardedOpens: 0, firstOpenAt: null, lastOpenAt: null,
    });
  });
});
