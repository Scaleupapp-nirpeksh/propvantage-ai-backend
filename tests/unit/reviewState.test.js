import { nextReviewStatus, applyOverrides } from '../../services/reports/reviewState.js';

describe('nextReviewStatus', () => {
  it('allows the legal transitions', () => {
    expect(nextReviewStatus('draft', 'submit')).toBe('in_review');
    expect(nextReviewStatus('in_review', 'approve')).toBe('approved');
    expect(nextReviewStatus('in_review', 'request_changes')).toBe('changes_requested');
    expect(nextReviewStatus('changes_requested', 'submit')).toBe('in_review');
  });
  it('returns null for illegal transitions', () => {
    expect(nextReviewStatus('draft', 'approve')).toBeNull();
    expect(nextReviewStatus('approved', 'approve')).toBeNull();
    expect(nextReviewStatus('approved', 'submit')).toBeNull();
    expect(nextReviewStatus('in_review', 'submit')).toBeNull();
    expect(nextReviewStatus('whatever', 'submit')).toBeNull();
  });
});

describe('applyOverrides', () => {
  const blocks = [
    { id: 'b1', type: 'kpi.revenue', data: { value: 100, unit: 'currency' } },
    { id: 'b2', type: 'text.note', data: { text: 'hi' } },
  ];
  it('applies an override to the targeted block/field without touching others', () => {
    const out = applyOverrides(blocks, [{ blockId: 'b1', fieldPath: 'data.value', newValue: 250 }]);
    expect(out[0].data.value).toBe(250);
    expect(out[0].data.unit).toBe('currency'); // sibling preserved
    expect(out[1].data.text).toBe('hi');       // other block untouched
  });
  it('does not mutate the input blocks', () => {
    applyOverrides(blocks, [{ blockId: 'b1', fieldPath: 'data.value', newValue: 999 }]);
    expect(blocks[0].data.value).toBe(100);
  });
  it('returns the blocks unchanged when there are no overrides', () => {
    expect(applyOverrides(blocks, [])).toBe(blocks);
    expect(applyOverrides(blocks, undefined)).toBe(blocks);
  });
});
