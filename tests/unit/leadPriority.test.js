// tests/unit/leadPriority.test.js
import { derivePriorityFromTimeline, LEAD_PRIORITIES } from '../../utils/leadPriority.js';

describe('derivePriorityFromTimeline', () => {
  it('maps immediate and 1-3 months to High', () => {
    expect(derivePriorityFromTimeline('immediate')).toBe('High');
    expect(derivePriorityFromTimeline('1-3_months')).toBe('High');
  });
  it('maps 3-6 months to Medium, 6-12 to Low, 12+ to Very Low', () => {
    expect(derivePriorityFromTimeline('3-6_months')).toBe('Medium');
    expect(derivePriorityFromTimeline('6-12_months')).toBe('Low');
    expect(derivePriorityFromTimeline('12+_months')).toBe('Very Low');
  });
  it('defaults unknown/missing timeline to Very Low', () => {
    expect(derivePriorityFromTimeline(undefined)).toBe('Very Low');
    expect(derivePriorityFromTimeline('garbage')).toBe('Very Low');
  });
  it('exposes the 4 priority levels (no Critical)', () => {
    expect(LEAD_PRIORITIES).toEqual(['High', 'Medium', 'Low', 'Very Low']);
  });
});
